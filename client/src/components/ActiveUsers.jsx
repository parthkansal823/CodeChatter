import { useMemo } from "react";
import UserAvatar from "./UserAvatar";

export default function ActiveUsers({ users = [] }) {

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => Number(b.active) - Number(a.active));
  }, [users]);

  const colors = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500"
  ];

  return (
    <div className="flex -space-x-2">

      {sortedUsers.map((user, index) => {

        <div key={user.name} className="relative">
          <UserAvatar
            username={user.name}
            size="base"
            className={`border-2 border-white dark:border-zinc-950 ${user.active ? "ring-2 ring-green-400" : "opacity-40"}`}
          />
          {user.active && (
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5
                bg-green-400 border-2 border-white dark:border-zinc-950
                rounded-full"
            />
          )}
        </div>

      })}

    </div>
  );
}
