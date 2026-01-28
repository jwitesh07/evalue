import React from "react";
import InterviewScreen from "./InterviewScreen";

export default function CommunicationInterview({ setCurrentScreen }) {
  const questions = [
    "How would you explain a complex idea to a non-technical person?",
    "How do you handle feedback?",
    "Describe your communication style in a team.",
  ];

  return (
    <InterviewScreen
      setCurrentScreen={setCurrentScreen}
      title="Communication-Based Interview"
      questions={questions}
    />
  );
}
