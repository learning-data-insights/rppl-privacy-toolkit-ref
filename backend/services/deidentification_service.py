import pandas as pd
from openai import OpenAI
import os
import logging

logger = logging.getLogger(__name__)

class DeidentificationService:
    def __init__(self, api_key=None, base_url=None, model=None):
        self.client = None
        self.model = None
        self.configure(api_key=api_key, base_url=base_url, model=model)

        # Load prompts from existing CSV file
        self.prompts_df = self.load_prompts()
        self.default_prompt = self.prompts_df['prompt'].iloc[0] if not self.prompts_df.empty else ""
    
    def configure(self, api_key=None, base_url=None, model=None):
        final_api_key = (
            api_key or
            os.getenv("OPENAI_API_KEY") or
            "ollama"
        )

        final_base_url = (
            base_url or
            os.getenv("OPENAI_BASE_URL") or
            "https://api.openai.com/v1"
        )

        final_model = (
            model or
            os.getenv("DEIDENTIFICATION_MODEL") or
            "gpt-4o"
        )

        self.client = OpenAI(
            api_key=final_api_key,
            base_url=final_base_url
        )

        self.model = final_model
        self.api_key = final_api_key
        self.base_url = final_base_url

    def load_prompts(self):
        """Load prompts from the Prompts.csv file"""
        prompts_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'data',
            'Prompts.csv'
        )
        try:
            return pd.read_csv(prompts_path, encoding='utf-8')
        except Exception as e:
            logger.error(f"Error loading prompts from CSV: {str(e)}")
            return pd.DataFrame({'prompt': ['']})
    
    # def set_api_key(self, api_key):
    #     """Set or update the OpenAI API key"""
    #     self.api_key = api_key
    #     self.client = OpenAI(api_key=api_key, base_url="http://ollama:11434/v1")
    
    def api_call(self, post_text, prompt):
        """Direct copy of the original api_call function from de_identified_csv_generator.py"""
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")
        
        try:
            message_content = f'{prompt}\n{post_text}'
            response_check = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": message_content}
                ],
                max_tokens=1000
            )
            return response_check.choices[0].message.content.strip()
        except Exception as e:
            error_msg = str(e)
            logger.error(f"OpenAI API call failed for text: {post_text[:50]}...")
            
            # Check for specific API key errors
            if "401" in error_msg or "Incorrect API key" in error_msg or "authentication" in error_msg.lower():
                logger.error("Authentication failed - Please check your API key is valid and has proper permissions")
            elif "429" in error_msg:
                logger.error("Rate limit exceeded - Please wait before retrying")
            elif "insufficient_quota" in error_msg or "quota" in error_msg.lower():
                logger.error("API quota exceeded - Please check your OpenAI account balance")
            else:
                logger.error(f"API error details: {error_msg}")
                
            return "API_ERROR"
    
    def api_call_batch(self, texts: list, prompt: str):
        """
        Process multiple texts in a single API call for better performance.
        
        Args:
            texts: List of text strings to process
            prompt: The redaction prompt to use
            
        Returns:
            List of redacted texts in the same order
        """
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")
        
        if not texts:
            return []
        
        try:
            # Format batch request with numbered items
            batch_content = f"{prompt}\n\nProcess the following {len(texts)} text(s), returning each redacted version on a new line separated by '---NEXT---':\n\n"
            for i, text in enumerate(texts, 1):
                batch_content += f"[TEXT {i}]\n{text}\n\n"
            
            batch_content += "\nReturn the redacted versions in the same order, separated by '---NEXT---'. Do not include the [TEXT N] markers in your response."
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that redacts sensitive information from text."},
                    {"role": "user", "content": batch_content}
                ],
                max_tokens=2000 * len(texts)  # Scale tokens with batch size
            )
            
            result = response.choices[0].message.content.strip()
            
            # Split the result by separator
            redacted_texts = [text.strip() for text in result.split('---NEXT---')]
            
            # Validate we got the right number of responses
            if len(redacted_texts) != len(texts):
                logger.warning(f"Batch response count mismatch: expected {len(texts)}, got {len(redacted_texts)}")
                # Fall back to individual processing if batch failed
                return [self.api_call(text, prompt) for text in texts]
            
            return redacted_texts
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Batch API call failed: {error_msg}")
            # Fall back to individual processing
            logger.info("Falling back to individual API calls for this batch")
            return [self.api_call(text, prompt) for text in texts]
    
    def process_dataframe(self, df, prompt_index=0, prompt_text: str = None, batch_size=8, progress_callback=None, columns_to_process=None):
        """
        Process a dataframe using batch API calls for improved performance.

        Args:
            df: DataFrame to process
            prompt_index: Index of prompt to use
            prompt_text: Optional custom prompt text (overrides prompt_index)
            batch_size: Number of rows to process per API call (default: 8, optimized for speed vs. accuracy)
            progress_callback: Optional callback function to report progress (batch_num, total_batches)
            columns_to_process: List of column names to process. If None, looks for 'post_text_original' (backward compatibility)
        """
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")

        # Handle column selection with backward compatibility
        if columns_to_process is None:
            # Legacy behavior: require 'post_text_original'
            if 'post_text_original' not in df.columns:
                error_msg = (
                    "No columns specified for processing and default column 'post_text_original' not found. "
                    f"Available columns: {', '.join(df.columns.tolist())}. "
                    "Please specify which columns to process."
                )
                logger.error(error_msg)
                raise ValueError(error_msg)
            columns_to_process = ['post_text_original']

        # Validate all specified columns exist
        missing_columns = [col for col in columns_to_process if col not in df.columns]
        if missing_columns:
            error_msg = (
                f"Specified columns not found in CSV: {', '.join(missing_columns)}. "
                f"Available columns: {', '.join(df.columns.tolist())}"
            )
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # Get prompt from loaded prompts or use default
        # If a session-provided prompt_text exists, use that (session-only override)
        if prompt_text:
            prompt = prompt_text
        else:
            if prompt_index < len(self.prompts_df):
                prompt = self.prompts_df['prompt'].iloc[prompt_index]
            else:
                prompt = self.default_prompt

        # Auto-generate ID column if it doesn't exist
        if 'id' not in df.columns:
            logger.info("No 'id' column found, auto-generating IDs")
            df = df.copy()
            df.insert(0, 'id', range(1, len(df) + 1))

        results = []
        total_rows = len(df)

        # Process each column separately
        for col_name in columns_to_process:
            logger.info(f"Processing column: {col_name}")
            print(f"\nProcessing column: {col_name}")

            # Collect all texts and their metadata for this column
            rows_to_process = []
            for row_idx in df.index:
                original_text = df.loc[row_idx, col_name]

                rows_to_process.append({
                    'index': row_idx,
                    'text': original_text,
                    'id': df.loc[row_idx, 'id']
                })

            # Process in batches
            total_batches = (len(rows_to_process) + batch_size - 1) // batch_size
            column_results = []

            for batch_num in range(0, len(rows_to_process), batch_size):
                batch = rows_to_process[batch_num:batch_num + batch_size]
                batch_texts = [row['text'] for row in batch]

                current_batch = (batch_num // batch_size) + 1

                # Report progress via callback if provided
                if progress_callback:
                    progress_callback(current_batch, total_batches)

                logger.info(f"Processing batch {current_batch}/{total_batches} ({len(batch)} rows) for column '{col_name}'")
                print(f"Progress: Batch {current_batch}/{total_batches} - Rows {batch_num + 1}-{min(batch_num + batch_size, len(rows_to_process))}/{len(rows_to_process)}")

                # Call batch API
                redacted_texts = self.api_call_batch(batch_texts, prompt)

                # Store results for this column
                for row, redacted_text in zip(batch, redacted_texts):
                    column_results.append({
                        'id': row['id'],
                        'index': row['index'],
                        'original': row['text'],
                        'redacted': redacted_text
                    })

            # Merge column results into main results
            output_col_name = f"{col_name}_OpenAI_redacted"

            if not results:
                # First column - create result entries with ID and original columns
                for row_result in column_results:
                    result_entry = {
                        'id': row_result['id'],
                        col_name: row_result['original'],
                        output_col_name: row_result['redacted']
                    }
                    results.append(result_entry)
            else:
                # Additional columns - add to existing results
                for i, row_result in enumerate(column_results):
                    results[i][col_name] = row_result['original']
                    results[i][output_col_name] = row_result['redacted']

        logger.info(f"Completed processing {len(results)} rows across {len(columns_to_process)} column(s)")
        print(f"Processing complete: {len(results)} rows processed across {len(columns_to_process)} column(s)")

        return results
    
    def process_csv_file(self, filepath, prompt_index=0, columns_to_process=None):
        """Process a CSV file following the original script logic"""
        df = pd.read_csv(filepath, encoding='utf-8', encoding_errors='replace')
        return self.process_dataframe(df, prompt_index, columns_to_process=columns_to_process)

    @staticmethod
    def detect_text_columns(df):
        """
        Detect columns that contain text data suitable for de-identification.

        Args:
            df: DataFrame to analyze

        Returns:
            List of column names that appear to contain text data
        """
        text_columns = []

        for col in df.columns:
            # Skip ID-like columns
            if col.lower() in ['id', 'index', 'row_id', 'record_id']:
                continue

            # Check if column contains string data
            if df[col].dtype == 'object' or pd.api.types.is_string_dtype(df[col]):
                # Sample some non-null values to check if they look like text
                sample = df[col].dropna().head(10)

                if len(sample) > 0:
                    # Check if values are reasonably long strings (not just codes or short identifiers)
                    avg_length = sample.astype(str).str.len().mean()

                    # Consider it a text column if average length > 20 characters
                    if avg_length > 20:
                        text_columns.append(col)

        return text_columns

    @staticmethod
    def get_column_info(df):
        """
        Get information about all columns in the dataframe.

        Args:
            df: DataFrame to analyze

        Returns:
            Dictionary with column info including name, type, sample values, and whether it's recommended for processing
        """
        text_columns = DeidentificationService.detect_text_columns(df)
        column_info = []

        for col in df.columns:
            # Get sample value (first non-null)
            sample_value = None
            non_null = df[col].dropna()
            if len(non_null) > 0:
                sample_value = str(non_null.iloc[0])
                # Truncate if too long
                if len(sample_value) > 100:
                    sample_value = sample_value[:100] + "..."

            column_info.append({
                'name': col,
                'type': str(df[col].dtype),
                'sample': sample_value,
                'is_text': col in text_columns,
                'recommended': col in text_columns
            })

        return column_info