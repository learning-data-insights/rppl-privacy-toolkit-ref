# RPPL Privacy Toolkit

An integrated web application for CSV file de-identification and redaction review, combining OpenAI-powered PII removal with manual review capabilities.

## Features

- **CSV File Processing**: Upload and process multiple CSV files simultaneously
- **AI-Powered De-identification**: Uses OpenAI GPT-4 to identify and redact PII
- **Ground Truth Evaluation**: Compare results against human-validated redactions
- **Metrics Calculation**: Automatic calculation of accuracy, precision, recall, and Kappa scores
- **Interactive Redaction Review**: Visual diff interface to review and adjust redactions
- **Batch Download**: Export all processed files as a zip archive

## Architecture

```
rppl-privacy-toolkit/
├── backend/                 # Flask API server
│   ├── app.py              # Main Flask application
│   ├── services/           # Business logic services
│   │   ├── deidentification_service.py
│   │   └── evaluation_service.py
│   ├── utils/              # Utility functions
│   │   └── file_handler.py
│   ├── data/               # Configuration and sample data
│   │   ├── Prompts.csv     # De-identification prompts
│   │   └── sample_data/    # Optional sample files
│   └── requirements.txt    # Python dependencies
├── frontend/               # React TypeScript application
│   ├── src/
│   │   ├── App.tsx        # Main React component
│   │   └── main.tsx       # Application entry point
│   ├── package.json       # Node dependencies
│   └── index.html         # HTML entry point
├── start.bat              # Windows startup script
├── start.sh               # Unix/Linux startup script
└── README.md              # This file
```

## Prerequisites

- Python 3.8+
- Node.js 16+
- OpenAI API key

## Installation

From the root directory (`rppl-privacy-toolkit-ref`):

### 1. Install Python Dependencies

```bash
# Create and activate virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install Python packages
pip install -r requirements.txt
```

### 2. Install Node Dependencies

```bash
npm install
```

That's it! All dependencies are now installed.

## Running the Application

You can start the application in several ways:

### Option 1: Using the startup scripts (Recommended)

**Windows:**
```bash
start.bat
```

**Mac/Linux:**
```bash
./start.sh
```

### Option 2: Manual startup

From the root directory, open two terminals:

**Terminal 1 - Backend:**
```bash
# Activate virtual environment first
venv\Scripts\activate  # Windows
# or
source venv/bin/activate  # Mac/Linux

# Start Flask server
cd backend && python app.py
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

The Flask backend will run on `http://localhost:5000`
The React frontend will run on `http://localhost:3000`

## Usage

1. **Upload Files**: 
   - Navigate to `http://localhost:3000`
   - Upload your CSV files in Step 1
   - Files should have columns like `id` and `post_text` or `post_text_original`

2. **Configure Settings**:
   - Enter your OpenAI API key
   - Optionally upload ground truth files for evaluation
   - Select a de-identification prompt

3. **Process Files**:
   - Click "Process Files" to run de-identification
   - View metrics if ground truth was provided

4. **Review & Export**:
   - Review redactions in the diff view
   - Toggle checkboxes to undo specific redactions
   - Click "Save & Download" to export results

## API Endpoints

- `POST /api/upload` - Upload CSV files
- `POST /api/deidentify` - Process files for de-identification
- `POST /api/update-redactions` - Update redaction states
- `GET /api/download/<session_id>` - Download processed files
- `GET /api/prompts` - Get available prompts

## Data Format

### Input CSV Format
```csv
id,post_text_original
1,"Sample text with PII like John Doe from New York"
```

### Output Format
```csv
id,post_text_original,post_text_OpenAI_redacted
1,"Sample text with PII like John Doe from New York","Sample text with PII like [REDACTED] from [REDACTED]"
```

## Environment Variables

Create a `.env` file in the backend directory (optional):

```env
OPENAI_API_KEY=your-api-key-here
FLASK_ENV=development
```

## Production Deployment

For production deployment:

1. Build the frontend:
```bash
cd frontend
npm run build
```

2. Configure the Flask app to serve the built frontend
3. Use a production WSGI server like Gunicorn
4. Set up proper CORS origins
5. Use environment variables for sensitive configuration

## Customization

### Adding Custom Prompts

To add new de-identification prompts:
1. Open `backend/data/Prompts.csv`
2. Add a new row with your custom prompt
3. Restart the backend server to load the new prompts

### Sample Data

Place sample CSV files in `backend/data/sample_data/` for testing:
- `original_files/`: CSV files with PII
- `human_redacted_files/`: Ground truth files with validated redactions

## License

[Your License Here]

## Support

For issues or questions, please open an issue in the repository.