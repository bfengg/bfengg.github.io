import React from "react";
import "../styles/tailwind.css";
import { SavingsVisualizer } from "../components/SavingsVisualizer/Visualizer";

function VisualizerPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <SavingsVisualizer />
      </div>
    </div>
  );
}

export default VisualizerPage;
