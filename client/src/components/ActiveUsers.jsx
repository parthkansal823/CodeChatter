import { useMemo } from "react";
import UserAvatar from "./UserAvatar";

export default function ActiveUsers({ users = [] }) {

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => Number(b.active) - Number(a.active));
  }, [users]);

  const colors = [
    "bg-danger-500",
    "bg-info-500",
    "bg-success-500",
    "bg-brand-500",
    "bg-danger-500",
    "bg-warning-500"
  ];

  return (
    <div className="flex -space-x-2">
      {sortedUsers.map((user, index) => {
        const colorClass = colors[index % colors.length];
        
        return (
          <div key={user.name} className="relative transition-transform hover:-translate-y-1 hover:z-10 cursor-default" title={user.name}>
            <UserAvatar
              username={user.name}
              size="base"
              className={`border-2 border-zinc-950 shadow-md ${user.active ? `ring-2 ${colorClass.replace('bg-', 'ring-')}` : "opacity-40"}`}
            />
            {user.active && (
              <span
                className={`absolute bottom-0 right-0 w-3 h-3
                  ${colorClass} border-2 border-zinc-50 dark:border-zinc-950
                  rounded-full shadow-sm`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
