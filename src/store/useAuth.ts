import { create } from "zustand";

type AuthState = { uid: string };
export const useAuth = create<AuthState>(() => ({
  uid: `u_${Math.random().toString(36).slice(2, 9)}`,
}));
