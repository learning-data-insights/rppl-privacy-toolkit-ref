import pandas as pd
from openai import OpenAI
import os
import logging

logger = logging.getLogger(__name__)

class DeidentificationService:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.client = None
        if api_key:
            self.client = OpenAI(api_key=api_key)
        
        # Load prompts from existing CSV file
        self.prompts_df = self.load_prompts()
        self.default_prompt = self.prompts_df['prompt'].iloc[0] if not self.prompts_df.empty else ""
    
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
    
    def set_api_key(self, api_key):
        """Set or update the OpenAI API key"""
        self.api_key = api_key
        self.client = OpenAI(api_key=api_key)
    
    def api_call(self, post_text, prompt):
        """Direct copy of the original api_call function from de_identified_csv_generator.py"""
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")
        
        try:
            message_content = f'{prompt}\n{post_text}'
            response_check = self.client.chat.completions.create(
                model="gpt-4.1-mini",
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
                model="gpt-4.1-mini",
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
    
    def process_dataframe(self, df, prompt_index=0, prompt_text: str = None, batch_size=8, progress_callback=None):
        """
        Process a dataframe using batch API calls for improved performance.
        
        Args:
            df: DataFrame to process
            prompt_index: Index of prompt to use
            prompt_text: Optional custom prompt text (overrides prompt_index)
            batch_size: Number of rows to process per API call (default: 8, optimized for speed vs. accuracy)
            progress_callback: Optional callback function to report progress (batch_num, total_batches)
        """
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")
        
        # Validate required column exists
        if 'post_text_original' not in df.columns:
            error_msg = (
                "Required column 'post_text_original' not found in CSV file. "
                f"Found columns: {', '.join(df.columns.tolist())}. "
                "Please rename your text column to 'post_text_original' and try again."
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
        
        results = []
        total_rows = len(df)
        
        # Collect all texts and their metadata first
        rows_to_process = []
        for row_idx in df.index:
            # Only use post_text_original column
            original_text = df.loc[row_idx, 'post_text_original']
            
            rows_to_process.append({
                'index': row_idx,
                'text': original_text,
                'id': df.loc[row_idx, 'id'] if 'id' in df.columns else row_idx
            })
        
        # Process in batches
        total_batches = (len(rows_to_process) + batch_size - 1) // batch_size
        
        for batch_num in range(0, len(rows_to_process), batch_size):
            batch = rows_to_process[batch_num:batch_num + batch_size]
            batch_texts = [row['text'] for row in batch]
            
            current_batch = (batch_num // batch_size) + 1
            
            # Report progress via callback if provided
            if progress_callback:
                progress_callback(current_batch, total_batches)
            
            logger.info(f"Processing batch {current_batch}/{total_batches} ({len(batch)} rows)")
            print(f"Progress: Batch {current_batch}/{total_batches} - Rows {batch_num + 1}-{min(batch_num + batch_size, len(rows_to_process))}/{len(rows_to_process)}")
            
            # Call batch API
            redacted_texts = self.api_call_batch(batch_texts, prompt)
            
            # Create result entries
            for row, redacted_text in zip(batch, redacted_texts):
                result_entry = {
                    'id': row['id'],
                    'post_text_original': row['text'],
                    'post_text_OpenAI_redacted': redacted_text
                }
                results.append(result_entry)
        
        logger.info(f"Completed processing {len(results)}/{total_rows} rows")
        print(f"Processing complete: {len(results)}/{total_rows} rows processed")
        
        return results
    
    def process_csv_file(self, filepath, prompt_index=0):
        """Process a CSV file following the original script logic"""
        df = pd.read_csv(filepath, encoding='utf-8', encoding_errors='replace')
        return self.process_dataframe(df, prompt_index)