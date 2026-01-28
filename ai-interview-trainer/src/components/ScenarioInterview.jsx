import React from "react";
import InterviewScreen from "./InterviewScreen";

export default function ScenarioInterview({ setCurrentScreen }) {
  const questions = [
    "Describe a situation where you resolved a team conflict.",
    "Tell me about a time you made a tough decision.",
    "How do you prioritize when faced with multiple deadlines?",
  ];

  return (
    <InterviewScreen
      setCurrentScreen={setCurrentScreen}
      title="Scenario-Based Interview"
      questions={questions}
    />
  );
}
