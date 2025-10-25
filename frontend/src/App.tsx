import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import DeviceDashboard from "./pages/DeviceDashboard";
import HomePage from "./pages/HomePage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="device/:deviceId" element={<DeviceDashboard />} />
      </Route>
    </Routes>
  );
}

export default App;
