import React from "react";
import Client from "./Clients";

function Sidebar({ clients, copyRoomId, leaveRoom }) {
  return (
    <aside className="sidebar">
      <img src="/images/codechatter1.png" alt="CodeChatter" className="sidebar-logo" />
      <div className="sidebar-members">
        <h5>Active Members</h5>
        <div className="members-list">
          {clients.map((client) => (
            <Client key={client.socketId} username={client.username} />
          ))}
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="btn-gradient" onClick={copyRoomId}>
          Copy Room ID
        </button>
        <button className="btn-red" onClick={leaveRoom}>
          Leave Room
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
