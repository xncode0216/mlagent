import { QueryClientProvider } from "@tanstack/react-query";

import { AppShell } from "./AppShell";
import { createQueryClient } from "../lib/queryClient";

// 应用级单例：整个会话共享一个 QueryClient（及其缓存）。
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
