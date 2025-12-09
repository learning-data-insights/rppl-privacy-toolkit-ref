from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import io
import pandas as pd
import numpy as np
import json
from datetime import datetime
import tempfile
import zipfile
import logging
import sys
from dotenv import load_dotenv

from backend.services.deidentification_service import DeidentificationService
from backend.services.evaluation_service import EvaluationService
from backend.utils.file_handler import FileHandler
from backend.utils.diff_generator import DiffGenerator

# Load environment variables from .env file
load_dotenv()

# Configure logging for AWS Elastic Beanstalk
# This ensures logs are captured properly in CloudWatch
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)  # Output to stdout for AWS EB
    ]
)
logger = logging.getLogger(__name__)

application = Flask(__name__)
CORS(application)

application.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
application.config['UPLOAD_FOLDER'] = 'backend/temp_uploads'
application.config['RESULTS_FOLDER'] = 'backend/results'

# Create necessary directories
os.makedirs(application.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(application.config['RESULTS_FOLDER'], exist_ok=True)

# Initialize services
deidentification_service = DeidentificationService()
evaluation_service = EvaluationService()
file_handler = FileHandler(application.config['UPLOAD_FOLDER'], application.config['RESULTS_FOLDER'])

# Store session data (in production, use Redis or database)
sessions = {}

def convert_to_json_serializable(obj):
    """Convert numpy types to JSON-serializable Python types"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_json_serializable(item) for item in obj]
    else:
        return obj

@application.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

@application.route('/api/upload', methods=['POST'])
def upload_files():
    """Upload CSV files for processing"""
    try:
        # Clean up previous results when new files are uploaded
        results_folder = application.config['RESULTS_FOLDER']
        if os.path.exists(results_folder):
            for filename in os.listdir(results_folder):
                file_path = os.path.join(results_folder, filename)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        import shutil
                        shutil.rmtree(file_path)
                except Exception as e:
                    logger.warning(f"Error deleting {file_path}: {e}")

        # Also clean up temp_uploads folder
        uploads_folder = application.config['UPLOAD_FOLDER']
        if os.path.exists(uploads_folder):
            for filename in os.listdir(uploads_folder):
                file_path = os.path.join(uploads_folder, filename)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        import shutil
                        shutil.rmtree(file_path)
                except Exception as e:
                    logger.warning(f"Error deleting {file_path}: {e}")
        
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        ground_truth_files = request.files.getlist('groundTruthFiles')

        session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        sessions[session_id] = {
            'files': [],
            'ground_truth': [],
            'processed': False,
            'results': None
        }
        
        # Process uploaded files
        for file in files:
            if file and file.filename.endswith('.csv'):
                filename = secure_filename(file.filename)
                filepath = os.path.join(application.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
                file.save(filepath)

                # Read CSV - keep all columns
                df = pd.read_csv(filepath)

                # Get column information for auto-detection
                column_info = DeidentificationService.get_column_info(df)

                sessions[session_id]['files'].append({
                    'name': filename,
                    'path': filepath,
                    'data': convert_to_json_serializable(df.to_dict('records')),
                    'columns': column_info
                })
        
        # Process ground truth files if provided
        for file in ground_truth_files:
            if file and file.filename.endswith('.csv'):
                filename = secure_filename(file.filename)
                filepath = os.path.join(application.config['UPLOAD_FOLDER'], f"{session_id}_gt_{filename}")
                file.save(filepath)
                
                df = pd.read_csv(filepath)
                sessions[session_id]['ground_truth'].append({
                    'name': filename,
                    'path': filepath,
                    'data': convert_to_json_serializable(df.to_dict('records'))
                })
        
        return jsonify({
            'session_id': session_id,
            'files_uploaded': len(sessions[session_id]['files']),
            'ground_truth_uploaded': len(sessions[session_id]['ground_truth'])
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@application.route('/api/deidentify', methods=['POST'])
def deidentify():
    """Process files for deidentification"""
    try:
        data = request.json
        session_id = data.get('session_id')
        prompt_index = data.get('prompt_index', 0)
        api_key = data.get('api_key')
        model = data.get('model')  # New parameter for model selection
        columns_to_process = data.get('columns_to_process')  # New parameter

        if not session_id or session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400

        session = sessions[session_id]
        results = []

        deidentification_service.configure(api_key=api_key, model=model)

        prompt_text = data.get('prompt_text')

        # Initialize progress tracking
        session['progress'] = {'current': 0, 'total': 0, 'status': 'starting'}

        def update_progress(current_batch, total_batches):
            """Callback to update progress in session"""
            session['progress'] = {
                'current': current_batch,
                'total': total_batches,
                'status': 'processing'
            }

        for file_info in session['files']:
            # Process each file
            df = pd.DataFrame(file_info['data'])

            # Use specified columns or auto-detect, but only process columns that exist in this file
            if columns_to_process:
                # Filter to only columns that exist in this specific file
                available_columns = set(df.columns)
                columns_for_this_file = [col for col in columns_to_process if col in available_columns]

                if not columns_for_this_file:
                    logger.warning(f"None of the selected columns exist in {file_info['name']}. Skipping file.")
                    continue

                logger.info(f"Processing {file_info['name']} with columns: {columns_for_this_file}")
            else:
                # Auto-detect text columns
                columns_for_this_file = DeidentificationService.detect_text_columns(df)
                logger.info(f"Auto-detected columns for {file_info['name']}: {columns_for_this_file}")

            # Perform deidentification with progress callback
            redacted_data = deidentification_service.process_dataframe(
                df, prompt_index, prompt_text,
                progress_callback=update_progress,
                columns_to_process=columns_for_this_file
            )
            
            # Calculate metrics if ground truth available - per column
            metrics_list = []
            if session['ground_truth']:
                # Find matching ground truth file (try exact match first, then base name match)
                gt_file = next((gt for gt in session['ground_truth']
                              if gt['name'] == file_info['name']), None)

                # If no exact match, try matching by base name (without _gt suffix)
                if not gt_file:
                    base_name = file_info['name'].replace('.csv', '')
                    for gt in session['ground_truth']:
                        gt_base = gt['name'].replace('.csv', '').replace('_gt', '').replace('-gt', '')
                        if gt_base == base_name or base_name in gt['name']:
                            gt_file = gt
                            break

                if gt_file:
                    gt_df = pd.DataFrame(gt_file['data'])

                    # Calculate metrics for each processed column
                    for col_name in columns_for_this_file:
                        try:
                            col_metrics = evaluation_service.calculate_metrics(
                                redacted_data,
                                gt_df,
                                df,
                                column_name=col_name
                            )
                            metrics_list.append({
                                'column': col_name,
                                'metrics': col_metrics
                            })
                            logger.info(f"Metrics calculated for column '{col_name}' in file '{file_info['name']}'")
                        except Exception as e:
                            logger.error(f"Failed to calculate metrics for column '{col_name}' in file '{file_info['name']}': {str(e)}")
                            # Continue with other columns even if one fails
                            metrics_list.append({
                                'column': col_name,
                                'metrics': None,
                                'error': str(e)
                            })
            
            # Generate diff for this file
            # Pass the full original data - DiffGenerator will extract relevant columns
            logger.info(f"Generating diff for {file_info['name']}")
            logger.info(f"Original data count: {len(file_info['data'])}, Redacted data count: {len(redacted_data)}")

            diff_string = DiffGenerator.generate_csv_diff(
                file_info['data'],  # Original data with all columns
                redacted_data,      # Redacted data with original + redacted columns
                file_info['name']
            )
            
            if not diff_string:
                logger.error(f"Generated diff is empty for {file_info['name']}")
                diff_string = "# Error: No diff generated"
            
            logger.info(f"Diff generated, length: {len(diff_string)}")

            # Save diff to a file for this session
            diff_filename = f"{session_id}_{file_info['name']}.diff"
            diff_path = os.path.join(application.config['RESULTS_FOLDER'], diff_filename)
            with open(diff_path, 'w', encoding='utf-8') as f:
                f.write(diff_string)
            
            results.append({
                'fileName': file_info['name'],
                'original': convert_to_json_serializable(file_info['data']),
                'redacted': convert_to_json_serializable(redacted_data),
                'metrics': convert_to_json_serializable(metrics_list) if metrics_list else None,
                'diff_file': diff_filename  # Store filename instead of content
            })
        
        session['processed'] = True
        session['results'] = results
        
        return jsonify({
            'session_id': session_id,
            'results': convert_to_json_serializable(results)
        })
    
    except ValueError as e:
        # Handle API key related errors specifically
        error_msg = str(e)
        if "API key" in error_msg:
            logger.error(f"API key error in deidentify endpoint: {error_msg}")
            logger.error("Please check your API key and ensure it's valid")
        else:
            logger.error(f"ValueError in deidentify endpoint: {error_msg}")
        return jsonify({'error': error_msg}), 400
    except Exception as e:
        logger.error(f"Error in deidentify endpoint: {str(e)}")
        logger.exception("Full traceback:")
        return jsonify({'error': str(e)}), 500

@application.route('/api/progress/<session_id>', methods=['GET'])
def get_progress(session_id):
    """Get processing progress for a session"""
    try:
        if session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400
        
        session = sessions[session_id]
        progress = session.get('progress', {'current': 0, 'total': 0, 'status': 'unknown'})
        
        return jsonify(progress)
    except Exception as e:
        logger.error(f"Error getting progress: {str(e)}")
        return jsonify({'error': str(e)}), 500

@application.route('/api/update-redactions', methods=['POST'])
def update_redactions():
    """Save user-edited text from diff view"""
    try:
        data = request.json
        session_id = data.get('session_id')
        updates = data.get('updates')
        
        if not session_id or session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400
        
        session = sessions[session_id]
        
        if session['results'] and updates:
            for update in updates:
                file_name = update.get('fileName', '').replace('{original → new}/', '')
                final_text = update.get('finalText') or update.get('text')
                
                for result in session['results']:
                    if result['fileName'] == file_name:
                        if 'user_edits' not in result:
                            result['user_edits'] = {}
                        result['user_edits']['full_text'] = final_text
                        break
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@application.route('/api/diff/<filename>', methods=['GET'])
def get_diff(filename):
    """Serve diff files as plain text"""
    try:
        # Sanitize filename to prevent directory traversal
        safe_filename = secure_filename(filename)
        diff_path = os.path.join(application.config['RESULTS_FOLDER'], safe_filename)
        
        if not os.path.exists(diff_path):
            return jsonify({'error': 'Diff file not found'}), 404
        
        with open(diff_path, 'r', encoding='utf-8') as f:
            diff_content = f.read()
        
        # Return as plain text with proper headers
        from flask import Response
        return Response(diff_content, mimetype='text/plain')
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@application.route('/api/download/<session_id>', methods=['GET'])
def download_results(session_id):
    """Download processed files as a zip"""
    try:
        if session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 404
        
        session = sessions[session_id]
        if not session['processed'] or not session['results']:
            return jsonify({'error': 'No results available'}), 400
        
        # Create a temporary zip file
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, f'redacted_files_{session_id}.zip')
        
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for result in session['results']:
                # Use redacted data as base (has all columns including ID and redacted versions)
                df = pd.DataFrame(result['redacted'])

                # Find redacted columns and create user_edited columns
                redacted_columns = [col for col in df.columns if col.endswith('_OpenAI_redacted')]

                # Create user_edited columns
                for redacted_col in redacted_columns:
                    base_col = redacted_col.replace('_OpenAI_redacted', '')
                    user_edited_col = f'{base_col}_user_edited'
                    df[user_edited_col] = None

                # Reorder columns: id, then for each column: original, redacted, user_edited
                ordered_columns = ['id'] if 'id' in df.columns else []

                for redacted_col in redacted_columns:
                    base_col = redacted_col.replace('_OpenAI_redacted', '')
                    # Add original, redacted, then user_edited for each column
                    if base_col in df.columns:
                        ordered_columns.append(base_col)
                    ordered_columns.append(redacted_col)
                    ordered_columns.append(f'{base_col}_user_edited')

                # Add any remaining columns that weren't processed
                for col in df.columns:
                    if col not in ordered_columns:
                        ordered_columns.append(col)

                # Reorder the dataframe
                df = df[ordered_columns]

                # Fill in user edits if available
                if 'user_edits' in result and 'full_text' in result['user_edits']:
                    user_text = result['user_edits']['full_text']
                    user_lines = [line.strip() for line in user_text.split('\n') if line.strip()]

                    # Process each redacted column to find user edits
                    for redacted_col in redacted_columns:
                        base_col = redacted_col.replace('_OpenAI_redacted', '')
                        user_edited_col = f'{base_col}_user_edited'

                        # For each row, check if the user edited it
                        for row_idx, row in df.iterrows():
                            original_text = str(row[base_col]) if pd.notna(row[base_col]) else ''
                            redacted_text = str(row[redacted_col]) if pd.notna(row[redacted_col]) else ''

                            # Skip if no change was made
                            if original_text == redacted_text:
                                continue

                            # Check if user chose original over redacted version
                            for user_line in user_lines:
                                has_original = original_text in user_line
                                has_redacted_marker = '[REDACTED]' in user_line

                                if has_original and not has_redacted_marker:
                                    df.at[row_idx, user_edited_col] = original_text
                                    break
                                elif len(original_text) <= 50 and original_text == user_line:
                                    df.at[row_idx, user_edited_col] = original_text
                                    break
                
                # Write to zip
                csv_buffer = io.StringIO()
                df.to_csv(csv_buffer, index=False)
                file_name = result['fileName'].replace('.csv', '_redacted.csv')
                zipf.writestr(file_name, csv_buffer.getvalue())
                
                # Add metrics if available
                if result.get('metrics'):
                    metrics_content = json.dumps(result['metrics'], indent=2)
                    metrics_name = result['fileName'].replace('.csv', '_metrics.json')
                    zipf.writestr(metrics_name, metrics_content)
        
        return send_file(zip_path, as_attachment=True, 
                        download_name=f'redacted_files_{session_id}.zip')
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@application.route('/api/download-single/<session_id>/<filename>', methods=['GET'])
def download_single_file(session_id, filename):
    """Download a single processed file as CSV"""
    try:
        if session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 404
        
        session = sessions[session_id]
        if not session['processed'] or not session['results']:
            return jsonify({'error': 'No results available'}), 400
        
        # Find the requested file
        result = next((r for r in session['results'] if r['fileName'] == filename), None)
        if not result:
            return jsonify({'error': 'File not found'}), 404
        
        # Build the CSV with all columns
        df = pd.DataFrame(result['redacted'])

        # Find redacted columns and create user_edited columns
        redacted_columns = [col for col in df.columns if col.endswith('_OpenAI_redacted')]

        # Create user_edited columns
        for redacted_col in redacted_columns:
            base_col = redacted_col.replace('_OpenAI_redacted', '')
            user_edited_col = f'{base_col}_user_edited'
            df[user_edited_col] = None

        # Reorder columns: id, then for each column: original, redacted, user_edited
        ordered_columns = ['id'] if 'id' in df.columns else []

        for redacted_col in redacted_columns:
            base_col = redacted_col.replace('_OpenAI_redacted', '')
            # Add original, redacted, then user_edited for each column
            if base_col in df.columns:
                ordered_columns.append(base_col)
            ordered_columns.append(redacted_col)
            ordered_columns.append(f'{base_col}_user_edited')

        # Add any remaining columns that weren't processed
        for col in df.columns:
            if col not in ordered_columns:
                ordered_columns.append(col)

        # Reorder the dataframe
        df = df[ordered_columns]

        # Fill in user edits if available
        if 'user_edits' in result and 'full_text' in result['user_edits']:
            user_text = result['user_edits']['full_text']
            user_lines = [line.strip() for line in user_text.split('\n') if line.strip()]

            # Process each redacted column to find user edits
            for redacted_col in redacted_columns:
                base_col = redacted_col.replace('_OpenAI_redacted', '')
                user_edited_col = f'{base_col}_user_edited'

                # For each row, check if the user edited it
                for row_idx, row in df.iterrows():
                    original_text = str(row[base_col]) if pd.notna(row[base_col]) else ''
                    redacted_text = str(row[redacted_col]) if pd.notna(row[redacted_col]) else ''

                    # Skip if no change was made
                    if original_text == redacted_text:
                        continue

                    # Check if user chose original over redacted version
                    for user_line in user_lines:
                        has_original = original_text in user_line
                        has_redacted_marker = '[REDACTED]' in user_line

                        if has_original and not has_redacted_marker:
                            df.at[row_idx, user_edited_col] = original_text
                            break
                        elif len(original_text) <= 50 and original_text == user_line:
                            df.at[row_idx, user_edited_col] = original_text
                            break
        
        # Convert to CSV
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        
        # Create response
        output = io.BytesIO()
        output.write(csv_buffer.getvalue().encode('utf-8'))
        output.seek(0)
        
        download_filename = filename.replace('.csv', '_redacted.csv')
        return send_file(output, mimetype='text/csv', as_attachment=True, download_name=download_filename)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@application.route('/api/delete-session/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """Delete all data associated with a session"""
    try:
        if session_id not in sessions:
            return jsonify({'error': 'Session not found'}), 404

        session = sessions.get(session_id, {})
        deleted_files = []

        # Delete uploaded files
        for file_info in session.get('files', []):
            filepath = file_info.get('path')
            if filepath and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    deleted_files.append(filepath)
                except Exception as e:
                    logger.warning(f"Failed to delete file {filepath}: {e}")

        # Delete ground truth files
        for gt_file in session.get('ground_truth', []):
            filepath = gt_file.get('path')
            if filepath and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    deleted_files.append(filepath)
                except Exception as e:
                    logger.warning(f"Failed to delete ground truth file {filepath}: {e}")

        # Delete diff files from results folder
        results_folder = application.config['RESULTS_FOLDER']
        for filename in os.listdir(results_folder):
            if filename.startswith(f"{session_id}_"):
                filepath = os.path.join(results_folder, filename)
                try:
                    os.remove(filepath)
                    deleted_files.append(filepath)
                except Exception as e:
                    logger.warning(f"Failed to delete result file {filepath}: {e}")

        # Remove session from memory
        del sessions[session_id]

        logger.info(f"Deleted session {session_id} and {len(deleted_files)} files")

        return jsonify({
            'success': True,
            'message': f'Session {session_id} and all associated data have been deleted',
            'files_deleted': len(deleted_files)
        })

    except Exception as e:
        logger.error(f"Error deleting session {session_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@application.route('/api/columns/<session_id>', methods=['GET'])
def get_columns(session_id):
    """Get column information for uploaded files in a session"""
    try:
        if session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400

        session = sessions[session_id]
        files_columns = []

        for file_info in session['files']:
            files_columns.append({
                'fileName': file_info['name'],
                'columns': file_info.get('columns', [])
            })

        return jsonify({'files': files_columns})

    except Exception as e:
        logger.error(f"Error getting columns: {str(e)}")
        return jsonify({'error': str(e)}), 500

@application.route('/api/prompts', methods=['GET'])
def get_prompts():
    """Get available prompts from the CSV file"""
    try:
        # Load prompts from the service
        prompts_df = deidentification_service.prompts_df
        prompts = []

        for idx, row in prompts_df.iterrows():
            prompts.append({
                'id': idx + 1,
                'name': 'Default Prompt' if idx == 0 else f'Prompt {idx + 1}',
                'text': row['prompt']
            })

        # If no prompts loaded, provide a default
        if not prompts:
            prompts = [{
                'id': 1,
                'name': 'Default',
                'text': 'Please remove any personally identifiable information (PII) and replace with [REDACTED].'
            }]

        return jsonify(prompts)
    except Exception as e:
        logger.error(f"Error loading prompts: {str(e)}")
        return jsonify([{
            'id': 1,
            'name': 'Default Prompt',
            'text': 'Please remove any personally identifiable information (PII) and replace with [REDACTED].'
        }])

@application.route('/api/config', methods=['GET'])
def get_config():
    """Get current API configuration to display in UI"""
    try:
        # Parse available models from environment variable
        available_models_str = os.getenv('AVAILABLE_MODELS', 'gpt-4o-mini')
        available_models = [model.strip() for model in available_models_str.split(',')]

        # Get the current configuration from the deidentification service
        config = {
            'model': deidentification_service.model,
            'base_url': deidentification_service.base_url,
            'is_local_model': deidentification_service.base_url != "https://api.openai.com/v1",
            'is_openai': deidentification_service.base_url == "https://api.openai.com/v1",
            'available_models': available_models
        }
        return jsonify(config)
    except Exception as e:
        logger.error(f"Error getting config: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Serve the React frontend
@application.route('/')
def serve_frontend():
    """Serve the main index.html file"""
    return send_file('frontend/dist/index.html')

@application.route('/<path:path>')
def serve_static(path):
    """Serve static files from the frontend dist folder"""
    # Check if the path is requesting an API endpoint
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
    
    # Try to serve the file from the dist folder
    try:
        return send_file(f'frontend/dist/{path}')
    except:
        # If file not found, return the index.html (for React Router)
        return send_file('frontend/dist/index.html')

if __name__ == '__main__':
    application.run(host="0.0.0.0", debug=True, port=5000)