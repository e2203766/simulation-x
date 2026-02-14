import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Audience from "./Audience.jsx";
import Stage from "./Stage.jsx";
import Performer from "./Performer.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/audience" replace />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/stage" element={<Stage />} />
        <Route path="/performer" element={<Performer />} />
        <Route path="*" element={<Navigate to="/audience" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

