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
                model="gpt-4",
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
    
    def process_dataframe(self, df, prompt_index=0, prompt_text: str = None):
        """Process a dataframe using the logic from de_identified_csv_generator.py"""
        if not self.client:
            logger.error("API key not set - Please check your API key")
            raise ValueError("API key not set - Please check your API key")
        
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
        
        # Process each row following the original logic
        for row_idx in df.index:
            # Check for the column name used in original files
            if 'post_text_original' in df.columns:
                original_text = df.loc[row_idx, 'post_text_original']
            elif 'post_text' in df.columns:
                original_text = df.loc[row_idx, 'post_text']
            else:
                # Handle other potential column names
                text_cols = [col for col in df.columns if 'text' in col.lower()]
                if text_cols:
                    original_text = df.loc[row_idx, text_cols[0]]
                else:
                    continue
            
            # Call the API using the original function logic
            post_text_response = self.api_call(original_text, prompt)
            
            # Create result entry maintaining original structure
            result_entry = {
                'id': df.loc[row_idx, 'id'] if 'id' in df.columns else row_idx,
                'post_text_original': original_text,
                'post_text_OpenAI_redacted': post_text_response
            }
            
            results.append(result_entry)
            
            print(f"Updated row {row_idx+1} for prompt {prompt_index+1} in dataframe.")
        
        return results
    
    def process_csv_file(self, filepath, prompt_index=0):
        """Process a CSV file following the original script logic"""
        df = pd.read_csv(filepath, encoding='utf-8', encoding_errors='replace')
        return self.process_dataframe(df, prompt_index)