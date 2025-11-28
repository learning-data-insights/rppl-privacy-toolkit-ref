import pandas as pd
import string
import os

class EvaluationService:
    def __init__(self):
        pass
    
    def count_redacted(self, text):
        """Direct copy from de_identified_csv_evaluator.py"""
        return text.count("[REDACTED]")
    
    def clean_text(self, text):
        """Direct copy from de_identified_csv_evaluator.py"""
        # Checks if text is a string, converts to string if not
        if not isinstance(text, str):
            text = str(text)
        
        text = text.translate(str.maketrans(string.punctuation, ' ' * len(string.punctuation)))
        words = text.split()
        words = [word for word in words if word.isalnum() and word.lower() not in ['a', 'an', 'the']]
        return words
    
    def calculate_metrics(self, redacted_data, ground_truth_df, original_df=None, column_name=None):
        """
        Calculate metrics by comparing AI-redacted text against human-redacted ground truth.

        Args:
            redacted_data: DataFrame or list with redacted data
            ground_truth_df: DataFrame with ground truth redactions
            original_df: Optional original DataFrame (unused, kept for API compatibility)
            column_name: Column name to process (required)
        """
        if not column_name:
            raise ValueError("column_name is required")

        # Convert list of dicts to DataFrame if needed
        if isinstance(redacted_data, list):
            redacted_df = pd.DataFrame(redacted_data)
        else:
            redacted_df = redacted_data

        # Expected column names with standard suffixes
        openai_col = f"{column_name}_OpenAI_redacted"
        human_col = f"{column_name}_human_redacted"

        # Check if required columns exist
        if openai_col not in redacted_df.columns:
            raise ValueError(f"Column '{openai_col}' not found in redacted data. Available: {redacted_df.columns.tolist()}")
        if human_col not in ground_truth_df.columns:
            raise ValueError(f"Column '{human_col}' not found in ground truth data. Available: {ground_truth_df.columns.tolist()}")

        # Merge dataframes on ID
        if 'id' in redacted_df.columns and 'id' in ground_truth_df.columns:
            df = pd.merge(redacted_df[['id', openai_col]],
                         ground_truth_df[['id', human_col]],
                         on='id', how='inner')
        else:
            # If no ID column, merge by index
            df = pd.concat([
                redacted_df[[openai_col]].reset_index(drop=True),
                ground_truth_df[[human_col]].reset_index(drop=True)
            ], axis=1)

        # Add word lists using the original functions
        df['word_list_redacted'] = df[human_col].apply(self.clean_text)
        df['word_list_openai_redacted'] = df[openai_col].apply(self.clean_text)
        
        # Calculate metrics using the exact logic from the original script
        total_true_positives = 0
        total_true_negatives = 0
        total_false_positives = 0
        total_false_negatives = 0
        total_words = 0
        
        tp_counts = []
        fp_counts = []
        fn_counts = []
        tn_counts = []
        
        for _, row in df.iterrows():
            row_tp = 0
            row_fp = 0
            row_fn = 0
            row_tn = 0
            
            human_words = row['word_list_redacted']
            openai_words = row['word_list_openai_redacted']
            
            # Ensure both lists have the same length
            min_len = min(len(human_words), len(openai_words))
            human_words = human_words[:min_len]
            openai_words = openai_words[:min_len]
            
            for hw, ow in zip(human_words, openai_words):
                total_words += 1
                if hw == ow and hw == 'REDACTED':
                    total_true_positives += 1
                    row_tp += 1
                elif hw != ow and hw != 'REDACTED' and ow == 'REDACTED':
                    total_false_positives += 1
                    row_fp += 1
                elif hw != ow and hw == 'REDACTED' and ow != 'REDACTED':
                    total_false_negatives += 1
                    row_fn += 1
                else:
                    total_true_negatives += 1
                    row_tn += 1
            
            tp_counts.append(row_tp)
            fp_counts.append(row_fp)
            fn_counts.append(row_fn)
            tn_counts.append(row_tn)
        
        # Calculate final metrics using original formulas
        if (total_true_positives + total_false_positives) > 0:
            precision = total_true_positives / (total_true_positives + total_false_positives)
        else:
            precision = 0
        
        if (total_true_positives + total_false_negatives) > 0:
            recall = total_true_positives / (total_true_positives + total_false_negatives)
        else:
            recall = 0
        
        if (total_false_negatives + total_true_negatives + total_true_positives + total_false_positives) > 0:
            accuracy = (total_true_positives + total_true_negatives) / (
                        total_false_negatives + total_true_negatives + total_true_positives + total_false_positives)
        else:
            accuracy = 0
        
        # Calculate Kappa using original formula
        if total_words > 0:
            observed_agreement = (total_true_positives + total_true_negatives) / total_words
            expected_agreement = ((total_true_positives + total_false_positives) * (total_true_positives + total_false_negatives) + 
                                (total_false_positives + total_true_negatives) * (total_false_negatives + total_true_negatives)) / (total_words ** 2)
            
            if expected_agreement < 1:
                kappa = (observed_agreement - expected_agreement) / (1 - expected_agreement)
            else:
                kappa = 0
        else:
            kappa = 0
        
        return {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'kappa': kappa,
            'true_positives': sum(tp_counts),
            'true_negatives': sum(tn_counts),
            'false_positives': sum(fp_counts),
            'false_negatives': sum(fn_counts)
        }