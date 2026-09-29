import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Home from "@/pages/Home";
import SharePage from "@/pages/SharePage";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/share/:shareId" element={<SharePage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default App;
