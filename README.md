# RPPL Privacy Toolkit

An integrated web application for CSV file de-identification and redaction review, combining OpenAI-powered PII removal with manual review capabilities.

## Features

- **CSV File Processing**: Upload and process multiple CSV files simultaneously
- **Flexible Column Selection**: Choose which columns to de-identify with auto-detection of text columns
- **Auto-Generated IDs**: Automatically creates ID columns if not present in your data
- **AI-Powered De-identification**: Uses OpenAI GPT-4 to identify and redact PII
- **Multi-Column Support**: Process multiple text columns in a single run
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

### Option 1: Docker (Recommended for Easy Setup)
- Docker Desktop (Windows/Mac) or Docker Engine + Docker Compose (Linux)
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

### Option 2: Manual Installation
- Python 3.8+
- Node.js 16+
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Quick Start with Docker using OpenAI API

Docker provides a single-command setup with no need to install Python, Node.js, or manage virtual environments.

### 1. Set Up Environment Variables

Create a `.env` file with your OpenAI API key:

```bash
# Copy the example file
cp .env.example .env

# Edit .env and replace 'your-api-key-here' with your actual API key
# Get your API key at: https://platform.openai.com/api-keys
```

### 2. Start the Application

```bash
docker compose up
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000

To stop the application:
```bash
docker compose down
```

To rebuild after code changes:
```bash
docker compose up --build
```

## Docker with Local LLMs

If you'd like to utilize local LLMs instead of external APIs (e.g., OpenAI), this application can work seamlessly with `Ollama` or `LM Studio`. Below are the configuration details and instructions for setting up each.

**Note:** When setting up local LLMs, you need to specify the name and size of the model (e.g., `gpt-oss:20b`, `gpt-oss:120b`, `llama3.3:70b`) in your `.env` file. Before selecting a model, verify that your machine has enough VRAM to support it. Reasonable results can be obtained with models of size at least 20b or larger. Smaller models may not perform well for this task.

---

### 1. Using Ollama

[Ollama](https://ollama.com/) is a platform that allows you to run local language models with ease. Follow these steps to integrate Ollama:

#### Prerequisites

- Install Docker and Docker Compose on your system.
- Ensure your `.env` file contains the appropriate settings for using Ollama:
  
  ```env
  # Ollama Configuration
  OPENAI_API_KEY=ollama
  OPENAI_BASE_URL=http://ollama:11434/v1
  DEIDENTIFICATION_MODEL=gpt-oss:20b
  ```


#### Steps to Run with Ollama

1. Use the provided `docker-compose-ollama.yml` file to set up and run the local Ollama service.
   ```bash
   docker compose -f docker-compose-ollama.yml up
   ```

2. This will:
   - Start an Ollama server on port `11434`.
   - Automatically pull the specified model (defined by `DEIDENTIFICATION_MODEL` in `.env`). Downloading and starting the model will take some time depending on your network connection and available computer resources.

3. Use the same `docker-compose.yml` file to start the backend and frontend services along with the ollama service:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose-ollama.yml up -d
   ```

After setup, the application will be accessible at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000

Ollama will run locally and process requests without sending data to external APIs.

---

### 2. Using LM Studio

[LM Studio](https://lmstudio.ai/) allows users to run local language models on personal hardware (CPU or GPU). It has a friendly user interface and therefore you may prefer this option over Ollama.

#### Prerequisites

- Install Docker and Docker Compose on your system.
- Open LM Studio and download a model (e.g. `gpt-oss-20b`).
- Ensure that LM Studio is configured properly to expose an API endpoint. Update the `.env` file with the following settings:

  ```env
  # LM Studio Configuration
  OPENAI_API_KEY=lmstudio
  OPENAI_BASE_URL=http://<lmstudio-ip>:1234/v1
  DEIDENTIFICATION_MODEL=gpt-oss-20b
  ```

  Replace `<lmstudio-ip>` with the actual IP address where LM Studio API is running (e.g., `localhost` or your server's IP).

#### Steps to Run with LM Studio

1. **Start LM Studio**:
   - If LM Studio isn't running already, follow their official guide for setup and starting the server.
   - Ensure it listens on the appropriate port (default: `1234`).

2. Start the application backend and frontend services with Docker:
   ```bash
   docker compose up
   ```

After setup, the application will process de-identification tasks via LM Studio, keeping all data processing local.

---

### Notes

- Both Ollama and LM Studio require downloading and running the language models locally. Be sure to have adequate disk space and system resources to handle model storage and runtime.
- For help configuring local models or troubleshooting, consult the official documentation for [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/).



## Manual Installation

From the root directory (`rppl-privacy-toolkit-ref`):

### 1. Set Up Environment Variables (Recommended)

Create a `.env` file in the root directory with your default OpenAI API key:

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your API key
# OPENAI_API_KEY=your-actual-api-key-here
```

**Note**: The `.env` file is git-ignored for security. Users can optionally override this with their own API key in the web interface.

### 2. Install Python Dependencies

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
   - Files can have any column names - the system will auto-detect text columns
   - If no `id` column exists, one will be automatically generated

2. **Configure Settings**:
   - The system auto-detects columns containing text suitable for de-identification
   - Review and select which columns you want to process (recommended columns are pre-selected)
   - You can select multiple columns to process in a single run
   - Optionally enter your own OpenAI API key (or use the default configured key)
   - Optionally upload ground truth files for evaluation
   - Select a de-identification prompt

3. **Process Files**:
   - Click "Process Files" to run de-identification
   - Processing time depends on file size and number of selected columns
   - View metrics if ground truth was provided

4. **Review & Export**:
   - Review redactions in the diff view
   - Toggle checkboxes to undo specific redactions
   - Click "Save & Download" to export results
   - Output files include original columns, redacted versions (e.g., `column_name_OpenAI_redacted`), and user-edited versions

## API Endpoints

- `POST /api/upload` - Upload CSV files
- `GET /api/columns/<session_id>` - Get column information for uploaded files
- `POST /api/deidentify` - Process files for de-identification (supports `columns_to_process` parameter)
- `POST /api/update-redactions` - Update redaction states
- `GET /api/download/<session_id>` - Download processed files
- `GET /api/prompts` - Get available prompts

## Data Format

### Input CSV Format

Your CSV files can have any column names. The system will auto-detect text columns suitable for de-identification.

**Example with custom column names:**
```csv
comment_id,user_comment,post_title
1,"John Doe from New York shared his experience","My healthcare journey"
2,"Contact me at jane@email.com for details","Support request"
```

**Legacy format (still supported):**
```csv
id,post_text_original
1,"Sample text with PII like John Doe from New York"
```

### Output Format

Output files include:
- Original columns (with auto-generated `id` if not present)
- Redacted versions with `_OpenAI_redacted` suffix
- User-edited versions with `_user_edited` suffix

**Example output:**
```csv
id,user_comment,user_comment_OpenAI_redacted,user_comment_user_edited,post_title,post_title_OpenAI_redacted,post_title_user_edited
1,"John Doe from New York...","[REDACTED] from [REDACTED]...",,"My healthcare journey","My healthcare journey",,
2,"Contact me at jane@email.com...","Contact me at [REDACTED]...",,"Support request","Support request",,
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