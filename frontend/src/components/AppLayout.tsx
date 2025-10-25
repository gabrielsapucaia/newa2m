import { Link, NavLink, Outlet } from "react-router-dom";

const AppLayout = () => {
  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight text-sky-400"
          >
            Aura Sensor - Telemetria
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `transition hover:text-sky-300 ${
                  isActive ? "text-sky-300" : "text-slate-300"
                }`
              }
            >
              Visao geral
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
