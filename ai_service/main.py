# """
# ai_service/main.py
# Robust Question Generator + Answer Evaluator API for Evalue

# Key features:
# - `/api/generate` accepts flexible JSON shapes (snake_case or camelCase).
# - Avoids FastAPI 422 by manually parsing JSON and returning friendly errors.
# - `/api/evaluate` accepts questions + answers and returns structured feedback using Gemini.
# - Keeps Gemini dual-key rotate logic and resume upload.
# - Adds logging of incoming request body for easier debugging.
# """

# import os
# import re
# import json
# import time
# import random
# import tempfile
# import logging
# from typing import List, Dict, Any, Optional

# from fastapi import FastAPI, UploadFile, File, Request
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel

# # resume parsing libs
# import fitz  # PyMuPDF
# import docx

# # Gemini client
# import google.generativeai as genai
# from dotenv import load_dotenv

# # ----------------------------
# # ENV + LOGGING
# # ----------------------------
# load_dotenv()
# GEMINI_KEY_FLASH = os.getenv("GEMINI_KEY_FLASH", "")
# GEMINI_KEY_LITE = os.getenv("GEMINI_KEY_LITE", "")

# if not GEMINI_KEY_FLASH and not GEMINI_KEY_LITE:
#     # allow running with a single key, but warn
#     logging.warning("No dual keys configured. Provide GEMINI_KEY_FLASH or GEMINI_KEY_LITE in env.")

# # configure default (will override per-call)
# if GEMINI_KEY_FLASH:
#     genai.configure(api_key=GEMINI_KEY_FLASH)

# logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
# logger = logging.getLogger("ai_service")

# app = FastAPI(title="Evalue AI Generator", version="5.0")
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # ----------------------------
# # Pydantic request model (for internal validation only – not used for FastAPI body)
# # ----------------------------
# class QuestionRequest(BaseModel):
#     category: str = "general"
#     resume_text: Optional[str] = ""
#     job_role: Optional[str] = None
#     years_experience: Optional[int] = None
#     prev_work: Optional[str] = None


# # ----------------------------
# # Helpers: file handling / resume extraction
# # ----------------------------
# def _save_upload_to_temp(upload_file: UploadFile) -> str:
#     suffix = ""
#     fname = (upload_file.filename or "").lower()
#     if fname.endswith(".pdf"):
#         suffix = ".pdf"
#     elif fname.endswith(".docx"):
#         suffix = ".docx"
#     elif fname.endswith(".txt"):
#         suffix = ".txt"

#     fd, path = tempfile.mkstemp(suffix=suffix)
#     os.close(fd)
#     with open(path, "wb") as f:
#         f.write(upload_file.file.read())
#     return path


# def extract_text_from_resume(upload_file: UploadFile) -> str:
#     path = _save_upload_to_temp(upload_file)
#     text = ""
#     try:
#         name = (upload_file.filename or "").lower()
#         if name.endswith(".pdf"):
#             try:
#                 with fitz.open(path) as pdf:
#                     text = "\n".join((page.get_text("text") or "") for page in pdf)
#             except Exception as e:
#                 logger.warning("PDF extraction failed: %s", e)

#         elif name.endswith(".docx"):
#             try:
#                 doc = docx.Document(path)
#                 text = "\n".join(p.text for p in doc.paragraphs)
#             except Exception as e:
#                 logger.warning("DOCX extraction failed: %s", e)

#         elif name.endswith(".txt"):
#             try:
#                 with open(path, "r", encoding="utf-8", errors="ignore") as f:
#                     text = f.read()
#             except Exception as e:
#                 logger.warning("TXT read failed: %s", e)

#         # Fallback: raw decode
#         if not text:
#             with open(path, "rb") as f:
#                 raw = f.read()
#                 try:
#                     text = raw.decode("utf-8", errors="ignore")
#                 except Exception:
#                     text = raw.decode("latin-1", errors="ignore")
#     finally:
#         try:
#             os.remove(path)
#         except Exception:
#             pass

#     return (text or "").strip()


# # ----------------------------
# # Simple resume summary extractor
# # ----------------------------
# def extract_resume_summary(text: str) -> Dict[str, List[str]]:
#     if not text:
#         return {"skills": [], "projects": []}

#     skills_keywords = [
#         "python", "java", "c++", "c#", "javascript", "typescript", "react",
#         "node", "express", "django", "flask", "fastapi", "mongodb", "postgres",
#         "mysql", "sql", "aws", "gcp", "azure", "docker", "kubernetes",
#         "tensorflow", "pytorch", "nlp", "opencv", "vosk", "ffmpeg",
#     ]
#     lower = text.lower()
#     skills = [s.capitalize() for s in skills_keywords if s in lower]
#     skills = list(dict.fromkeys(skills))[:12]

#     projects = re.findall(
#         r"(?:project|developed|built|implemented|created)\s(.+?)(?:[.\n]|$)",
#         text,
#         re.I,
#     )
#     projects = [p.strip(" .,-\n") for p in projects if p.strip()][:6]
#     projects = list(dict.fromkeys(projects))

#     return {"skills": skills, "projects": projects}


# # ----------------------------
# # JSON extractor (robust)
# # ----------------------------
# def _extract_json_from_text(raw_text: str) -> Optional[Any]:
#     if not raw_text:
#         return None
#     cleaned = re.sub(r"```(?:json)?", "", raw_text, flags=re.I).strip()
#     m = re.search(r"(\[.*\]|\{.*\})", cleaned, re.S)
#     candidate = m.group(1) if m else cleaned
#     try:
#         return json.loads(candidate)
#     except Exception:
#         # last resort: treat each line as a question
#         lines = [l.strip(" -•\t\n\r") for l in raw_text.splitlines() if l.strip()]
#         if not lines:
#             return None
#         return [{"id": i + 1, "question": line, "topic": "General"} for i, line in enumerate(lines)]


# # ----------------------------
# # Difficulty helper
# # ----------------------------
# def _difficulty_label(years: Optional[int]) -> str:
#     if years is None:
#         return "Intermediate"
#     if years < 2:
#         return "Beginner"
#     if years < 5:
#         return "Intermediate"
#     return "Advanced"


# # ----------------------------
# # Gemini wrapper (rotate between two keys/models)
# # ----------------------------
# def call_gemini(prompt: str, temperature: float = 0.85, max_tokens: int = 1400) -> Dict[str, Any]:
#     candidates: List[tuple] = []
#     if GEMINI_KEY_FLASH:
#         candidates.append(("models/gemini-2.0-flash", "flash", GEMINI_KEY_FLASH))
#     if GEMINI_KEY_LITE:
#         candidates.append(("models/gemini-2.0-flash-lite", "flash-lite", GEMINI_KEY_LITE))

#     last_error = None
#     if not candidates:
#         return {"ok": False, "error": "No Gemini API key configured"}

#     for model_name, key_label, api_key in candidates:
#         logger.info("Trying model %s (key=%s)", model_name, key_label)
#         genai.configure(api_key=api_key)
#         for attempt in range(3):
#             try:
#                 model = genai.GenerativeModel(model_name)
#                 resp = model.generate_content(
#                     prompt,
#                     generation_config=genai.types.GenerationConfig(
#                         temperature=temperature,
#                         top_p=0.9,
#                         max_output_tokens=max_tokens,
#                     ),
#                 )
#                 raw = getattr(resp, "text", "") or str(resp)
#                 parsed = _extract_json_from_text(raw)
#                 return {"ok": True, "parsed": parsed, "raw": raw, "modelUsed": model_name}
#             except Exception as e:
#                 msg = str(e)
#                 last_error = msg
#                 if "429" in msg or "quota" in msg.lower() or "exceeded" in msg.lower():
#                     logger.warning("Quota/rate-limit on %s: %s", model_name, msg)
#                     break
#                 backoff = 1.5 ** attempt
#                 logger.warning(
#                     "Transient error on %s attempt %d: %s — retrying in %.1fs",
#                     model_name,
#                     attempt + 1,
#                     msg,
#                     backoff,
#                 )
#                 time.sleep(backoff)
#     return {"ok": False, "error": last_error or "All models failed"}


# # ----------------------------
# # Prompt builder (supports categories and meta)
# # ----------------------------
# def build_prompt(
#     category: str,
#     resume_text: str,
#     skills: str,
#     projects: str,
#     job_role: Optional[str],
#     years_experience: Optional[int],
#     prev_work: Optional[str],
# ) -> str:
#     cat = (category or "general").lower().strip()
#     difficulty = _difficulty_label(years_experience)
#     role_line = f"Target job role: {job_role}." if job_role else ""
#     prev_line = f"Previous work / roles (short): {prev_work}." if prev_work else ""

#     if cat in ("resume", "resume-based", "resume_interview"):
#         return f"""
# You are a senior technical interviewer. Generate up to 15 technical interview questions strictly based on the resume text below.
# Return ONLY a valid JSON array (no explanation). Each object must include: id (number), question (string), topic (string), difficulty (Beginner|Intermediate|Advanced).

# --- RESUME START ---
# {resume_text[:16000]}
# --- RESUME END ---

# Candidate Skills: {skills}
# Candidate Projects: {projects}
# {role_line}
# {prev_line}
# Use difficulty: {difficulty}

# Rules:
# - Reference candidate's technologies/projects where possible.
# - Keep questions technical: design, architecture, performance, debugging, deployment, APIs.
# - If years_experience >= 5, include architecture, scaling and tradeoff questions (Advanced).
# - If resume lacks details, ask targeted follow-ups about skills listed.
# - Output JSON array only.
# """

#     if cat == "scenario":
#         return f"""
# Generate up to 15 scenario-based behavioral interview questions for role: {job_role or 'Candidate'}.
# Tune complexity to: {difficulty}.
# Use previous work context when provided:
# {prev_line}

# Return ONLY a JSON array with objects: {{
#   "id": <number>,
#   "question": <string>,
#   "topic": "Scenario",
#   "difficulty": "Beginner|Intermediate|Advanced"
# }}
# """

#     if cat == "communication":
#         return f"""
# Generate up to 15 communication-focused interview questions for role: {job_role or 'Candidate'}.
# Tune complexity to: {difficulty}.
# Use previous work context when provided:
# {prev_line}

# Return ONLY a JSON array with objects: {{
#   "id": <number>,
#   "question": <string>,
#   "topic": "Communication",
#   "difficulty": "Beginner|Intermediate|Advanced"
# }}
# """

#     if cat == "technical":
#         return f"""
# Generate up to 15 technical interview questions tailored to the target job role: {job_role or 'Candidate'}.
# Use previous work details as context: {prev_line}
# Set difficulty to: {difficulty} (Beginner/Intermediate/Advanced as appropriate).

# Return ONLY a JSON array. Each item must be:
# {{ "id": <n>, "question": <str>, "topic": <str e.g. 'Databases','APIs','System Design'>, "difficulty": "Beginner|Intermediate|Advanced" }}
# """

#     if cat == "hr":
#         return f"""
# Generate up to 15 HR-style interview questions (culture fit, compensation, growth, management style) tailored to role: {job_role or 'Candidate'}.
# Use previous work context: {prev_line}
# Tune complexity to: {difficulty}

# Return ONLY a JSON array with objects:
# {{ "id": <n>, "question": <str>, "topic": "HR", "difficulty": "Beginner|Intermediate|Advanced" }}
# """

#     return f"""
# Generate up to 15 interview questions for category: {cat} and role: {job_role or 'Candidate'}.
# Difficulty: {difficulty}
# Return ONLY a JSON array of objects including id, question, topic, difficulty.
# """


# # ============================================================
# # /api/generate endpoint
# # ============================================================
# @app.post("/api/generate")
# async def generate_questions(request: Request):
#     """
#     Robust handler:
#     - Accepts flexible JSON body (snake_case or camelCase)
#     - Logs the incoming body on parse errors and returns helpful error instead of 422
#     """
#     try:
#         raw_body = await request.body()
#         text_body = raw_body.decode("utf-8") if raw_body else ""
#         logger.debug("Incoming /api/generate body: %s", text_body)

#         # Try parse JSON
#         try:
#             payload = await request.json()
#         except Exception:
#             logger.error("Failed to parse JSON body for /api/generate. Raw body: %s", text_body)
#             return {"ok": False, "error": "Invalid JSON body. Raw body captured.", "raw_body": text_body}

#         # Normalize keys: accept camelCase or snake_case
#         def _get(key_variants, default=None):
#             for k in key_variants:
#                 if k in payload:
#                     return payload[k]
#             return default

#         category = (_get(["category"]) or "general").lower().strip()
#         resume_text = _get(["resume_text", "resumeText", "resume"]) or ""
#         job_role = _get(["job_role", "jobRole"]) or None
#         prev_work = _get(["prev_work", "prevWork"]) or None
#         years_experience = _get(["years_experience", "yearsExperience"])
#         try:
#             if years_experience is not None and years_experience != "":
#                 years_experience = int(years_experience)
#             else:
#                 years_experience = None
#         except Exception:
#             years_experience = None

#         # If resume-based category but resume_text missing -> error
#         if category in ("resume",) and not resume_text:
#             return {"ok": False, "error": "resume_text is required for category 'resume'."}

#         # Build prompt and call Gemini
#         summary = extract_resume_summary(resume_text)
#         skills = ", ".join(summary["skills"]) or "N/A"
#         projects = "; ".join(summary["projects"]) or "N/A"

#         prompt = build_prompt(
#             category, resume_text, skills, projects, job_role, years_experience, prev_work
#         )
#         logger.info("Generating questions (category=%s role=%s years=%s)", category, job_role, years_experience)

#         temperature = max(0.65, min(0.95, random.random()))
#         result = call_gemini(prompt, temperature=temperature, max_tokens=1400)

#         if not result.get("ok"):
#             logger.error("Gemini generation failed: %s", result.get("error"))
#             fallback = [
#                 {"id": 1, "question": "Describe a challenging project you worked on.", "topic": "General", "difficulty": "Intermediate"},
#                 {"id": 2, "question": "Explain a decision you made under pressure.", "topic": "General", "difficulty": "Intermediate"},
#                 {"id": 3, "question": "How do you debug production issues?", "topic": "General", "difficulty": "Intermediate"},
#                 {"id": 4, "question": "Describe a time you handled conflict in a team.", "topic": "Scenario", "difficulty": "Intermediate"},
#                 {"id": 5, "question": "Explain how you'd design a scalable API.", "topic": "Architecture", "difficulty": "Advanced"},
#                 {"id": 6, "question": "How do you prioritize tasks when overloaded?", "topic": "Scenario", "difficulty": "Intermediate"},
#                 {"id": 7, "question": "How do you explain complex tech to non-technical stakeholders?", "topic": "Communication", "difficulty": "Intermediate"},
#                 {"id": 8, "question": "Describe a time you took ownership of a failure.", "topic": "Scenario", "difficulty": "Intermediate"},
#                 {"id": 9, "question": "How would you optimize a slow database query?", "topic": "Databases", "difficulty": "Advanced"},
#                 {"id": 10, "question": "What's your approach to testing and QA?", "topic": "Testing", "difficulty": "Intermediate"},
#             ]
#             return {"ok": True, "questions": fallback, "modelUsed": None, "meta": {"fallback": True}}

#         parsed = result.get("parsed")
#         model_used = result.get("modelUsed")
#         raw_text = result.get("raw", "")

#         questions: List[Dict[str, Any]] = []
#         if isinstance(parsed, list):
#             for i, item in enumerate(parsed[:15]):
#                 if isinstance(item, dict):
#                     q_text = (item.get("question") or item.get("text") or "").strip()
#                     q_topic = item.get("topic") or item.get("category") or category.capitalize()
#                     q_diff = item.get("difficulty") or _difficulty_label(years_experience)
#                     questions.append({
#                         "id": int(item.get("id", i + 1)),
#                         "question": q_text,
#                         "topic": q_topic,
#                         "difficulty": q_diff,
#                     })
#                 else:
#                     questions.append({
#                         "id": i + 1,
#                         "question": str(item).strip(),
#                         "topic": category.capitalize(),
#                         "difficulty": _difficulty_label(years_experience),
#                     })
#         elif isinstance(parsed, dict) and "questions" in parsed and isinstance(parsed["questions"], list):
#             for i, item in enumerate(parsed["questions"][:15]):
#                 if isinstance(item, dict):
#                     q_text = (item.get("question") or item.get("text") or "").strip()
#                     q_topic = item.get("topic") or category.capitalize()
#                     q_diff = item.get("difficulty") or _difficulty_label(years_experience)
#                     questions.append({
#                         "id": int(item.get("id", i + 1)),
#                         "question": q_text,
#                         "topic": q_topic,
#                         "difficulty": q_diff,
#                     })
#                 else:
#                     questions.append({
#                         "id": i + 1,
#                         "question": str(item).strip(),
#                         "topic": category.capitalize(),
#                         "difficulty": _difficulty_label(years_experience),
#                     })
#         else:
#             lines = [l.strip(" -•\t\n\r") for l in (raw_text or "").splitlines() if l.strip()]
#             for i, line in enumerate(lines[:15]):
#                 questions.append({
#                     "id": i + 1,
#                     "question": line,
#                     "topic": category.capitalize(),
#                     "difficulty": _difficulty_label(years_experience),
#                 })

#         # Ensure at least 8 questions
#         while len(questions) < 8:
#             questions.append({
#                 "id": len(questions) + 1,
#                 "question": f"Additional {category} question {len(questions)+1}",
#                 "topic": category.capitalize(),
#                 "difficulty": _difficulty_label(years_experience),
#             })

#         questions = questions[:15]
#         logger.info("Generated %d questions using model=%s", len(questions), model_used)

#         return {
#             "ok": True,
#             "questions": questions,
#             "modelUsed": model_used,
#             "meta": {"skills": summary["skills"], "projects": summary["projects"]},
#         }

#     except Exception as exc:
#         logger.exception("Unexpected error in /api/generate")
#         return {"ok": False, "error": str(exc)}


# # ============================================================
# # /api/evaluate endpoint
# # ============================================================
# @app.post("/api/evaluate")
# async def evaluate_interview(request: Request):
#     """
#     Evaluate a completed interview.

#     Expected flexible JSON body (keys can be camelCase or snake_case):

#     {
#       "category": "technical",
#       "meta": { "jobRole": "...", "yearsExperience": 2, "prevWork": "..." },
#       "questions": [ { "id": 1, "question": "...", "topic": "...", "difficulty": "Intermediate" }, ... ],
#       "answers": [
#         {
#           "questionId": 1,
#           "question": "...",
#           "topic": "...",
#           "difficulty": "Intermediate",
#           "answer": "candidate answer text"
#         },
#         ...
#       ],
#       "fullTranscript": "optional combined transcript of everything"
#     }
#     """
#     try:
#         raw_body = await request.body()
#         text_body = raw_body.decode("utf-8") if raw_body else ""
#         logger.debug("Incoming /api/evaluate body: %s", text_body)

#         try:
#             payload = await request.json()
#         except Exception:
#             logger.error("Failed to parse JSON body for /api/evaluate. Raw body: %s", text_body)
#             return {"ok": False, "error": "Invalid JSON body for /api/evaluate", "raw_body": text_body}

#         # helpers to get values with multiple key variants
#         def _get(obj, variants, default=None):
#             if not isinstance(obj, dict):
#                 return default
#             for k in variants:
#                 if k in obj:
#                     return obj[k]
#             return default

#         category = (_get(payload, ["category"], "general") or "general").lower().strip()
#         meta = _get(payload, ["meta"], {}) or {}

#         # normalize meta keys
#         job_role = _get(meta, ["job_role", "jobRole"])
#         prev_work = _get(meta, ["prev_work", "prevWork"])
#         years_experience = _get(meta, ["years_experience", "yearsExperience"])
#         try:
#             if years_experience is not None and years_experience != "":
#                 years_experience = int(years_experience)
#             else:
#                 years_experience = None
#         except Exception:
#             years_experience = None

#         questions = _get(payload, ["questions"], []) or []
#         answers = _get(payload, ["answers"], []) or []
#         transcript = (
#             _get(payload, ["fullTranscript", "full_transcript", "transcript"], "") or ""
#         )

#         # Build a question-id -> question text mapping for safety
#         q_by_id: Dict[int, Dict[str, Any]] = {}
#         for q in questions:
#             try:
#                 qid = int(_get(q, ["id", "questionId"], 0))
#             except Exception:
#                 qid = 0
#             if not qid:
#                 continue
#             q_by_id[qid] = {
#                 "id": qid,
#                 "question": _get(q, ["question", "text"], ""),
#                 "topic": _get(q, ["topic", "category"], category.capitalize()),
#                 "difficulty": _get(q, ["difficulty", "level"], _difficulty_label(years_experience)),
#             }

#         # Normalized list of QA pairs to feed to Gemini
#         normalized_qa: List[Dict[str, Any]] = []
#         for ans in answers:
#             try:
#                 qid = int(_get(ans, ["questionId", "question_id", "id"], 0))
#             except Exception:
#                 qid = 0
#             answer_text = _get(ans, ["answer", "text", "response"], "")
#             if not answer_text:
#                 continue

#             q_info = q_by_id.get(qid, None)
#             if q_info is None:
#                 # build minimal if not present
#                 q_info = {
#                     "id": qid or len(normalized_qa) + 1,
#                     "question": _get(ans, ["question"], ""),
#                     "topic": _get(ans, ["topic"], category.capitalize()),
#                     "difficulty": _get(ans, ["difficulty"], _difficulty_label(years_experience)),
#                 }

#             normalized_qa.append(
#                 {
#                     "id": q_info["id"],
#                     "question": q_info["question"],
#                     "topic": q_info["topic"],
#                     "difficulty": q_info["difficulty"],
#                     "answer": answer_text,
#                 }
#             )

#         if not normalized_qa:
#             return {"ok": False, "error": "No answers provided for evaluation."}

#         # Build evaluation prompt for Gemini
#         difficulty = _difficulty_label(years_experience)
#         role_line = f"Target job role: {job_role}." if job_role else ""
#         prev_line = f"Previous work / roles: {prev_work}." if prev_work else ""

#         qa_block_lines = []
#         for item in normalized_qa:
#             qa_block_lines.append(
#                 f"Q{item['id']}: {item['question']}\n"
#                 f"Answer: {item['answer']}\n"
#                 f"Topic: {item['topic']} | Difficulty: {item['difficulty']}\n"
#             )
#         qa_block = "\n\n".join(qa_block_lines)

#         eval_prompt = f"""
# You are an expert interview evaluator for category: {category}.
# Evaluate the candidate's performance based on the questions and answers below.

# Context:
# - Difficulty level (overall): {difficulty}
# - {role_line}
# - {prev_line}

# Questions and Answers:
# {qa_block}

# If provided, this is the combined transcript of the interview (you may use it for nuance, but primary grading is per question):
# {transcript[:8000]}

# Return ONLY a valid JSON object with the following structure:

# {{
#   "overall_score": <integer 0-100>,
#   "summary": "<3-6 sentence overall feedback>",
#   "strengths": ["bullet point strength 1", "strength 2", ...],
#   "improvements": ["bullet point improvement 1", "improvement 2", ...],
#   "per_question": [
#     {{
#       "questionId": <id matching the input>,
#       "question": "<question text>",
#       "answer": "<candidate answer>",
#       "score": <integer 0-10>,
#       "feedback": "<2-4 sentences of feedback specific to this answer>"
#     }},
#     ...
#   ]
# }}

# Rules:
# - Be honest but constructive.
# - Scores should be consistent: 0 is terrible, 10 is exceptional, 5 is average.
# - Tailor feedback and suggestions to the role and difficulty.
# - Do NOT include any extra commentary outside the JSON.
# """

#         logger.info(
#             "Evaluating interview: category=%s role=%s years=%s questions=%d answers=%d",
#             category,
#             job_role,
#             years_experience,
#             len(questions),
#             len(normalized_qa),
#         )

#         result = call_gemini(eval_prompt, temperature=0.6, max_tokens=1200)
#         if not result.get("ok"):
#             logger.error("Gemini evaluation failed: %s", result.get("error"))
#             return {"ok": False, "error": result.get("error", "Evaluation failed")}

#         parsed = result.get("parsed")
#         raw_text = result.get("raw", "")
#         model_used = result.get("modelUsed")

#         # Try to normalize parsed output into expected shape
#         if not isinstance(parsed, dict):
#             logger.warning("Parsed evaluation is not a dict – wrapping fallback.")
#             parsed = {"raw": parsed}

#         overall_score = parsed.get("overall_score")
#         try:
#             if overall_score is not None:
#                 overall_score = int(overall_score)
#         except Exception:
#             overall_score = None

#         per_question = parsed.get("per_question") or parsed.get("questions") or []
#         if not isinstance(per_question, list):
#             per_question = []

#         # Light normalization on per_question array
#         normalized_per_q = []
#         for item in per_question:
#             if not isinstance(item, dict):
#                 continue
#             try:
#                 qid = int(item.get("questionId") or item.get("id") or 0)
#             except Exception:
#                 qid = 0
#             normalized_per_q.append(
#                 {
#                     "questionId": qid,
#                     "question": item.get("question", ""),
#                     "answer": item.get("answer", ""),
#                     "score": item.get("score", None),
#                     "feedback": item.get("feedback", ""),
#                 }
#             )

#         response_payload = {
#             "ok": True,
#             "overall_score": overall_score,
#             "summary": parsed.get("summary", ""),
#             "strengths": parsed.get("strengths", []),
#             "improvements": parsed.get("improvements", []),
#             "per_question": normalized_per_q,
#             "modelUsed": model_used,
#             "raw_model_output": raw_text,
#         }

#         return response_payload

#     except Exception as exc:
#         logger.exception("Unexpected error in /api/evaluate")
#         return {"ok": False, "error": str(exc)}


# # ============================================================
# # /api/upload-resume endpoint
# # ============================================================
# @app.post("/api/upload-resume")
# async def upload_resume(resume: UploadFile = File(...)):
#     try:
#         text = extract_text_from_resume(resume)
#         if not text:
#             return {"ok": False, "error": "Could not extract text from resume (empty)."}
#         summary = extract_resume_summary(text)
#         return {
#             "ok": True,
#             "resume_text": text[:16000],
#             "skills": summary["skills"],
#             "projects": summary["projects"],
#         }
#     except Exception as e:
#         logger.exception("Resume processing failed")
#         return {"ok": False, "error": str(e)}


# # ============================================================
# # Health check
# # ============================================================
# @app.get("/")
# def root():
#     return {
#         "message": "Evalue AI Generator Running",
#         "categories": ["resume", "scenario", "communication", "technical", "hr"],
#         "dual_key_mode": bool(GEMINI_KEY_FLASH and GEMINI_KEY_LITE),
#         "endpoints": ["/api/generate", "/api/upload-resume", "/api/evaluate"],
#     }
