import React from "react";

export default function RecommendationsModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-8 max-w-2xl mx-4">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold">Personalized Recommendations</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
        </div>
        <div className="space-y-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold mb-2">Improve Posture</h4>
            <p className="text-gray-600 text-sm">
              Sit straight with shoulders back for confident body language.
            </p>
          </div>
          <div className="border-l-4 border-green-500 pl-4">
            <h4 className="font-semibold mb-2">Maintain Strengths</h4>
            <p className="text-gray-600 text-sm">
              Great voice clarity and eye contact — keep it up!
            </p>
          </div>
          <div className="border-l-4 border-purple-500 pl-4">
            <h4 className="font-semibold mb-2">Boost Confidence</h4>
            <p className="text-gray-600 text-sm">
              Prepare power poses and mock answers before interviews.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
