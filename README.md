Evalue – AI-Powered Mock Interview Platform

Evalue is an AI-powered mock interview platform designed to simulate real-world interviews by dynamically generating role-specific, experience-based questions, analyzing verbal and non-verbal behavior in real time, and providing structured AI-driven feedback to help candidates improve interview performance.

🚀 Features
🧠 Intelligent Question Generation

Role-based interview questions (Technical, HR, Scenario, Communication)

Difficulty adapts automatically based on years of experience

Resume-aware and context-driven questions

Strict prevention of repeated questions

🎥 Real-Time Non-Verbal Analysis

Eye contact detection

Smile detection

Focus & attention tracking

Emotion recognition (e.g., Neutral, Distracted)

Powered by OpenCV & MediaPipe

🎙️ Speech & Audio Processing

Live audio capture

Speech-to-text using Vosk

Real-time transcription during interview

📊 AI-Based Answer Evaluation

Per-question scoring (0–10)

Overall interview score (0–100)

Strengths and improvement suggestions

Detailed, structured AI feedback

📄 Interview Reports

Complete interview summary

Performance insights

Ready for academic or professional review


🛠️ Tech Stack
Frontend:React,Vite,Tailwind CSS

Backend:FastAPI (Python),Node.js (Authentication & API layer)

AI & ML:Groq LLM (LLaMA-3.3-70B),OpenCV,MediaPipe

Speech Processing:whisper,FFmpeg

Database:mongo_db

⚙️ Installation & Setup
1️⃣ Clone the Repository
git clone https://github.com/your-username/evalue.git
cd evalue

2️⃣ Backend Setup (AI Service)
cd ai_service
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt


Create .env file:

GROQ_API_KEY=your_groq_api_key


Run FastAPI server:
uvicorn main_groq:app --reload

3️⃣ Frontend Setup
cd ai-interviewi-trainer
npm install
npm run dev


📸 Preview:
<img width="2890" height="1408" alt="image" src="https://github.com/user-attachments/assets/69d67de8-a588-4035-a9e3-d4aba6ad18e5" />
<img width="1351" height="714" alt="Screenshot 2026-01-28 at 5 05 34 PM" src="https://github.com/user-attachments/assets/198f9e59-1164-42d9-97eb-247b3afcb41e" />

<img width="1444" height="754" alt="Screenshot 2026-01-28 at 4 52 42 PM" src="https://github.com/user-attachments/assets/f24d87a8-4368-4403-8e47-4924cef4f317" />
<img width="1307" height="724" alt="Screenshot 2026-01-28 at 5 02 59 PM" src="https://github.com/user-attachments/assets/9901cd4e-e2bb-4429-93f4-4e90587b9f23" />
