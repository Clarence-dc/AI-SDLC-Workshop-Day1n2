import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { userDB } from "@/lib/db";
import AuthControls from "./auth-controls";
import TodoList from "./todo-list";

export default async function HomePage() {
  const session = await getSession();
  const user = session ? userDB.findById(session.userId) : null;
  if (!user) redirect("/login");

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user.username}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            You are signed in with a passkey.
          </p>
        </div>
        <AuthControls />
      </header>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Add another passkey before losing access to your current device.
        Account recovery is not available if you lose all your passkeys.
      </p>
      <TodoList />
    </main>
  );
}
