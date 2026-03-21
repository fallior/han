import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>HAN Admin</h1>
      </div>
      <nav className="sidebar-nav">
        <NavLink to="/" end>
          Overview
        </NavLink>
        <NavLink to="/projects">
          Projects
        </NavLink>
        <NavLink to="/work">
          Work
        </NavLink>
        <NavLink to="/workshop">
          Workshop
        </NavLink>
        <NavLink to="/supervisor">
          Supervisor
        </NavLink>
        <NavLink to="/reports">
          Reports
        </NavLink>
        <NavLink to="/conversations">
          Conversations
        </NavLink>
        <NavLink to="/memory">
          Memory
        </NavLink>
        <NavLink to="/products">
          Products
        </NavLink>
      </nav>
    </aside>
  );
}
