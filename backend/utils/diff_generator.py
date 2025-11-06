import difflib
import re
from typing import List, Dict, Any

class DiffGenerator:
    """Generates unified diff format for comparing original and redacted text"""
    
    @staticmethod
    def normalize_spacing(text: str) -> str:
        """
        Normalize spacing to prevent false diff chunks.
        - Reduces multiple spaces to single space
        - Preserves line breaks
        """
        lines = []
        for line in text.split('\n'):
            # Reduce multiple spaces to single space within each line
            normalized_line = re.sub(r' +', ' ', line).strip()
            lines.append(normalized_line)
        return '\n'.join(lines)
    
    @staticmethod
    def generate_diff(original_text: str, redacted_text: str, filename: str = "text") -> str:
        """
        Generate a unified diff between original and redacted text.
        
        Args:
            original_text: The original text with sensitive information
            redacted_text: The text with [REDACTED] replacements
            filename: The filename to use in the diff header
        
        Returns:
            A unified diff string compatible with diff2html
        """
        # Handle empty texts
        if not original_text:
            original_text = ""
        if not redacted_text:
            redacted_text = ""
        
        # Normalize spacing to prevent misalignment issues
        original_normalized = DiffGenerator.normalize_spacing(original_text)
        redacted_normalized = DiffGenerator.normalize_spacing(redacted_text)
            
        # Split texts into lines for comparison
        original_lines = original_normalized.splitlines(keepends=False)
        redacted_lines = redacted_normalized.splitlines(keepends=False)
        
        # Handle empty lines case
        if not original_lines:
            original_lines = ['']
        if not redacted_lines:
            redacted_lines = ['']
        
        # Generate unified diff
        diff = difflib.unified_diff(
            original_lines,
            redacted_lines,
            fromfile=f'original/{filename}',
            tofile=f'new/{filename}',
            lineterm='',
            n=1000  # Large context to ensure all lines are shown
        )
        
        # Convert generator to list and join
        diff_lines = list(diff)
        
        # If no differences, create a minimal diff showing the content
        if not diff_lines:
            # Create a fake diff header to show that content exists but hasn't changed
            diff_lines = [
                f'--- original/{filename}',
                f'+++ new/{filename}',
                '@@ -1,{} +1,{} @@'.format(len(original_lines), len(redacted_lines))
            ] + [' ' + line for line in original_lines[:50]]  # Show first 50 lines with context marker
            
            if len(original_lines) > 50:
                diff_lines.append(' ... ({} more lines)'.format(len(original_lines) - 50))
        
        return '\n'.join(diff_lines)
    
    @staticmethod
    def generate_multi_file_diff(file_pairs: List[Dict[str, Any]]) -> str:
        """
        Generate a combined unified diff for multiple file pairs.
        
        Args:
            file_pairs: List of dictionaries containing:
                - 'filename': Name of the file
                - 'original': Original text
                - 'redacted': Redacted text
        
        Returns:
            A combined unified diff string for all files
        """
        all_diffs = []
        
        for pair in file_pairs:
            filename = pair.get('filename', 'text.txt')
            original = pair.get('original', '')
            redacted = pair.get('redacted', '')
            
            # Generate diff for this file pair
            diff = DiffGenerator.generate_diff(original, redacted, filename)
            
            if diff:  # Only add if there are differences
                all_diffs.append(diff)
        
        # Join all diffs with a newline separator
        return '\n'.join(all_diffs)
    
    @staticmethod
    def generate_csv_diff(original_data: List[Dict], redacted_data: List[Dict], 
                         filename: str = "data.csv") -> str:
        """
        Generate a unified diff for CSV data by comparing text fields.
        Shows ALL rows, even unchanged ones, for review purposes.
        
        Args:
            original_data: List of original data records
            redacted_data: List of redacted data records
            filename: The filename to use in the diff header
        
        Returns:
            A unified diff string
        """
        # Add logging to debug
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Generating diff for {filename}")
        logger.info(f"Original data rows: {len(original_data)}")
        logger.info(f"Redacted data rows: {len(redacted_data)}")
        
        # Extract text content from records
        original_texts = []
        redacted_texts = []
        
        for idx, (orig, red) in enumerate(zip(original_data, redacted_data)):
            # Get the main text field (adjust based on your data structure)
            orig_text = orig.get('post_text_original') or orig.get('post_text', '')
            red_text = red.get('post_text_OpenAI_redacted') or red.get('post_text', '')
            
            # Skip posts where text is identical (no changes)
            if orig_text == red_text:
                continue
            
            if orig_text or red_text:
                # Check if we have an actual ID from the CSV (not just a row index)
                orig_id = orig.get('id', None)
                
                # Show Post ID only if:
                # 1. ID exists
                # 2. ID is a string (actual identifier from CSV)
                # 3. OR ID is a non-negative integer that looks like a real ID (not a pandas index)
                show_id = False
                if orig_id is not None:
                    if isinstance(orig_id, str):
                        # String IDs are always real IDs
                        show_id = True
                    elif isinstance(orig_id, (int, float)):
                        # Numeric IDs: show if they're non-negative integers
                        # This assumes CSV IDs start from 0 or 1
                        show_id = orig_id >= 0
                
                if show_id:
                    original_texts.append(f"Post ID: {orig_id}\n{orig_text}")
                    redacted_texts.append(f"Post ID: {orig_id}\n{red_text}")
                else:
                    # No ID or it's just a row index - don't show it
                    original_texts.append(orig_text)
                    redacted_texts.append(red_text)
        
        # Instead of using unified_diff which only shows changes,
        # create a side-by-side comparison that shows ALL content
        # We'll format it as a diff but ensure all lines are included
        
        logger.info(f"Combined {len(original_texts)} original texts")
        logger.info(f"Combined {len(redacted_texts)} redacted texts")
        
        # If no changes detected, create a message indicating all posts are unchanged
        if not original_texts:
            logger.info(f"No changes detected in {filename} - all posts identical")
            original_combined = "No changes detected.\n\nAll posts in this file were processed but no redactions were made."
            redacted_combined = "No changes detected.\n\nAll posts in this file were processed but no redactions were made."
        else:
            # Join posts with blank lines between them
            original_combined = '\n\n'.join(original_texts)
            redacted_combined = '\n\n'.join(redacted_texts)
        
        logger.info(f"Original combined length: {len(original_combined)}")
        logger.info(f"Redacted combined length: {len(redacted_combined)}")
        
        return DiffGenerator.generate_diff(original_combined, redacted_combined, filename)