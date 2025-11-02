#!/usr/bin/env python3
"""
Cleanup script to remove files older than 24 hours from temp directories.
This script is designed to be run as a cron job on AWS Elastic Beanstalk.
"""

import os
import time
import logging
from datetime import datetime, timedelta
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)  # Output to stdout for AWS CloudWatch
    ]
)
logger = logging.getLogger(__name__)

def cleanup_old_files(directory_path, max_age_hours=24):
    """
    Remove files older than max_age_hours from the specified directory.

    Args:
        directory_path: Path to the directory to clean
        max_age_hours: Maximum age of files in hours (default 24)

    Returns:
        Number of files deleted
    """
    if not os.path.exists(directory_path):
        logger.warning(f"Directory {directory_path} does not exist")
        return 0

    deleted_count = 0
    current_time = time.time()
    max_age_seconds = max_age_hours * 3600

    try:
        for filename in os.listdir(directory_path):
            file_path = os.path.join(directory_path, filename)

            # Skip directories
            if os.path.isdir(file_path):
                continue

            # Check file age
            file_age = current_time - os.path.getmtime(file_path)

            if file_age > max_age_seconds:
                try:
                    os.remove(file_path)
                    deleted_count += 1
                    file_age_hours = file_age / 3600
                    logger.info(f"Deleted {filename} (age: {file_age_hours:.1f} hours)")
                except Exception as e:
                    logger.error(f"Failed to delete {file_path}: {e}")

    except Exception as e:
        logger.error(f"Error processing directory {directory_path}: {e}")

    return deleted_count

def main():
    """Main cleanup function"""
    logger.info("Starting automated cleanup process")

    # Directories to clean
    directories_to_clean = [
        'backend/temp_uploads',
        'backend/results'
    ]

    total_deleted = 0

    for directory in directories_to_clean:
        logger.info(f"Cleaning directory: {directory}")
        deleted = cleanup_old_files(directory, max_age_hours=24)
        total_deleted += deleted
        logger.info(f"Deleted {deleted} file(s) from {directory}")

    logger.info(f"Cleanup complete. Total files deleted: {total_deleted}")

    # Also log to a file for audit purposes
    try:
        log_dir = 'cleanup_logs'
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, f'cleanup_{datetime.now().strftime("%Y%m%d")}.log')
        with open(log_file, 'a') as f:
            f.write(f"{datetime.now().isoformat()} - Deleted {total_deleted} files\n")
    except Exception as e:
        logger.warning(f"Could not write to log file: {e}")

if __name__ == "__main__":
    main()