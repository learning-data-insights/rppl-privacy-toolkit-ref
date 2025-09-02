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
    
    def calculate_metrics(self, redacted_data, ground_truth_df, original_df=None):
        """Calculate metrics using logic from de_identified_csv_evaluator.py"""
        
        # Convert list of dicts to DataFrame if needed
        if isinstance(redacted_data, list):
            redacted_df = pd.DataFrame(redacted_data)
        else:
            redacted_df = redacted_data
        
        # Prepare dataframes with required columns
        if 'post_text_OpenAI_redacted' not in redacted_df.columns:
            if 'post_text' in redacted_df.columns:
                redacted_df['post_text_OpenAI_redacted'] = redacted_df['post_text']
            elif 'post_text_OpenAI_redacted' in redacted_df.columns:
                pass  # Already has the column
        
        if 'post_text_human_redacted' not in ground_truth_df.columns:
            if 'post_text' in ground_truth_df.columns:
                ground_truth_df['post_text_human_redacted'] = ground_truth_df['post_text']
            elif 'post_text_redacted' in ground_truth_df.columns:
                ground_truth_df['post_text_human_redacted'] = ground_truth_df['post_text_redacted']
        
        # Merge dataframes on ID
        if 'id' in redacted_df.columns and 'id' in ground_truth_df.columns:
            df = pd.merge(redacted_df[['id', 'post_text_OpenAI_redacted']], 
                         ground_truth_df[['id', 'post_text_human_redacted']], 
                         on='id', how='inner')
        else:
            # If no ID column, merge by index
            df = pd.concat([
                redacted_df[['post_text_OpenAI_redacted']].reset_index(drop=True),
                ground_truth_df[['post_text_human_redacted']].reset_index(drop=True)
            ], axis=1)
        
        # Add word lists using the original functions
        df['word_list_redacted'] = df['post_text_human_redacted'].apply(self.clean_text)
        df['word_list_openai_redacted'] = df['post_text_OpenAI_redacted'].apply(self.clean_text)
        
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