import os
import re
import pandas as pd
from werkzeug.utils import secure_filename

class FileHandler:
    def __init__(self, upload_folder, results_folder):
        self.upload_folder = upload_folder
        self.results_folder = results_folder
        
        # Create folders if they don't exist
        os.makedirs(upload_folder, exist_ok=True)
        os.makedirs(results_folder, exist_ok=True)
    
    def sanitize_filename(self, filename):
        """Direct copy from redaction/server.py"""
        # Remove or replace characters that are not allowed in file names
        return re.sub(r'[^\w\-_\. ]', '_', filename)
    
    def extract_filename_with_regex(self, file_path):
        """Direct copy from redaction/server.py"""
        # Regex to match and capture the filename without extension
        match = re.search(r'/([^/]+)\.txt$', file_path)
        if match:
            return match.group(1)  # Group 1 contains the filename without extension
        return None  # Return None if no match is found
    
    def save_csv(self, dataframe, filename, folder=None):
        """Save a dataframe to CSV file"""
        if folder:
            folder_path = os.path.join(self.results_folder, self.sanitize_filename(folder))
            os.makedirs(folder_path, exist_ok=True)
            filepath = os.path.join(folder_path, filename)
        else:
            filepath = os.path.join(self.results_folder, filename)
        
        dataframe.to_csv(filepath, index=False)
        return filepath
    
    def read_csv(self, filepath):
        """Read a CSV file with the same encoding handling as original scripts"""
        return pd.read_csv(filepath, encoding='utf-8', encoding_errors='replace')
    
    def get_upload_path(self, filename, session_id=None):
        """Get the full path for an uploaded file"""
        if session_id:
            filename = f"{session_id}_{filename}"
        return os.path.join(self.upload_folder, secure_filename(filename))
    
    def get_results_path(self, filename, folder=None):
        """Get the full path for a results file"""
        if folder:
            folder_path = os.path.join(self.results_folder, self.sanitize_filename(folder))
            os.makedirs(folder_path, exist_ok=True)
            return os.path.join(folder_path, filename)
        return os.path.join(self.results_folder, filename)