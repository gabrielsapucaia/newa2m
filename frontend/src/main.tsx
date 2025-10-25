import * as echarts from "echarts/core";
import themeDark from "./lib/echartsThemeDark";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import Home from "./pages/Home";
import DeviceDashboard from "./pages/DeviceDashboard";

echarts.registerTheme("aura-dark", themeDark);

const qc = new QueryClient();
const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/device/:id", element: <DeviceDashboard /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);


