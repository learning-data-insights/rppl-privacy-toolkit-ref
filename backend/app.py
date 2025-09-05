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

from services.deidentification_service import DeidentificationService
from services.evaluation_service import EvaluationService
from utils.file_handler import FileHandler
from utils.diff_generator import DiffGenerator

app = Flask(__name__)
CORS(app, origins=['http://localhost:3000', 'http://localhost:5173'])

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'temp_uploads'
app.config['RESULTS_FOLDER'] = 'results'

# Create necessary directories
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['RESULTS_FOLDER'], exist_ok=True)

# Initialize services
deidentification_service = DeidentificationService()
evaluation_service = EvaluationService()
file_handler = FileHandler(app.config['UPLOAD_FOLDER'], app.config['RESULTS_FOLDER'])

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

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

@app.route('/api/upload', methods=['POST'])
def upload_files():
    """Upload CSV files for processing"""
    try:
        # Clean up previous results when new files are uploaded
        results_folder = app.config['RESULTS_FOLDER']
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
                    print(f"Error deleting {file_path}: {e}")
        
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
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
                file.save(filepath)
                
                # Read CSV and convert to JSON
                df = pd.read_csv(filepath)
                sessions[session_id]['files'].append({
                    'name': filename,
                    'path': filepath,
                    'data': convert_to_json_serializable(df.to_dict('records'))
                })
        
        # Process ground truth files if provided
        for file in ground_truth_files:
            if file and file.filename.endswith('.csv'):
                filename = secure_filename(file.filename)
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_gt_{filename}")
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

@app.route('/api/deidentify', methods=['POST'])
def deidentify():
    """Process files for deidentification"""
    try:
        data = request.json
        session_id = data.get('session_id')
        prompt_index = data.get('prompt_index', 0)
        api_key = data.get('api_key')
        
        if not session_id or session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400
        
        if not api_key:
            return jsonify({'error': 'API key required'}), 400
        
        session = sessions[session_id]
        results = []
        
        deidentification_service.set_api_key(api_key)
        
        prompt_text = data.get('prompt_text')
        for file_info in session['files']:
            # Process each file
            df = pd.DataFrame(file_info['data'])
            
            # Perform deidentification
            redacted_data = deidentification_service.process_dataframe(df, prompt_index, prompt_text)
            
            # Calculate metrics if ground truth available
            metrics = None
            if session['ground_truth']:
                # Find matching ground truth file
                gt_file = next((gt for gt in session['ground_truth'] 
                              if gt['name'] == file_info['name']), None)
                if gt_file:
                    gt_df = pd.DataFrame(gt_file['data'])
                    metrics = evaluation_service.calculate_metrics(
                        redacted_data, 
                        gt_df,
                        df
                    )
            
            # Generate diff for this file
            diff_string = DiffGenerator.generate_csv_diff(
                file_info['data'], 
                redacted_data,
                file_info['name']
            )
            
            # Save diff to a file for this session
            diff_filename = f"{session_id}_{file_info['name']}.diff"
            diff_path = os.path.join(app.config['RESULTS_FOLDER'], diff_filename)
            with open(diff_path, 'w', encoding='utf-8') as f:
                f.write(diff_string)
            
            results.append({
                'fileName': file_info['name'],
                'original': convert_to_json_serializable(file_info['data']),
                'redacted': convert_to_json_serializable(redacted_data),
                'metrics': convert_to_json_serializable(metrics) if metrics else None,
                'diff_file': diff_filename  # Store filename instead of content
            })
        
        session['processed'] = True
        session['results'] = results
        
        return jsonify({
            'session_id': session_id,
            'results': convert_to_json_serializable(results)
        })
    
    except Exception as e:
        print(f"Error in deidentify endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/update-redactions', methods=['POST'])
def update_redactions():
    """Update redaction states for manual review"""
    try:
        data = request.json
        session_id = data.get('session_id')
        updates = data.get('updates')
        
        if not session_id or session_id not in sessions:
            return jsonify({'error': 'Invalid session'}), 400
        
        session = sessions[session_id]
        
        # Apply updates to session results
        if session['results'] and updates:
            for update in updates:
                file_name = update.get('fileName')
                item_id = update.get('itemId')
                # Accept both 'text' and 'finalText' for backwards compatibility
                new_text = update.get('finalText') or update.get('text')
                
                # Find and update the specific item
                for result in session['results']:
                    if result['fileName'] == file_name:
                        for item in result['redacted']:
                            if item.get('id') == item_id:
                                # Update the redacted text
                                if 'post_text_OpenAI_redacted' in item:
                                    item['post_text_OpenAI_redacted'] = new_text
                                else:
                                    item['post_text'] = new_text
                                break
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/diff/<filename>', methods=['GET'])
def get_diff(filename):
    """Serve diff files as plain text"""
    try:
        # Sanitize filename to prevent directory traversal
        safe_filename = secure_filename(filename)
        diff_path = os.path.join(app.config['RESULTS_FOLDER'], safe_filename)
        
        if not os.path.exists(diff_path):
            return jsonify({'error': 'Diff file not found'}), 404
        
        with open(diff_path, 'r', encoding='utf-8') as f:
            diff_content = f.read()
        
        # Return as plain text with proper headers
        from flask import Response
        return Response(diff_content, mimetype='text/plain')
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/<session_id>', methods=['GET'])
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
                # Convert result to CSV
                df = pd.DataFrame(result['redacted'])
                csv_buffer = io.StringIO()
                df.to_csv(csv_buffer, index=False)
                
                # Add to zip
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

@app.route('/api/prompts', methods=['GET'])
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
        print(f"Error loading prompts: {str(e)}")
        return jsonify([{
            'id': 1,
            'name': 'Default Prompt',
            'text': 'Please remove any personally identifiable information (PII) and replace with [REDACTED].'
        }])

if __name__ == '__main__':
    app.run(debug=True, port=5000)