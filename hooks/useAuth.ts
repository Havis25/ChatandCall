// hooks/useAuth.ts
import { api } from "@/lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

type Ticket = {
  ticket_number: string;
  description: string;
  customer_status: string;
  issue_channel: string;
  created_time: string;
};

type Customer = {
  customer_id?: number | string;
  id?: number | string;
  full_name?: string;
  email?: string;
  address?: string;
  phone_number?: string;
  customer?: { id?: number | string; customer_id?: number | string } | null;
  tickets?: Ticket[];
  accounts?: Array<{ customer_id: number; account_id: number; [k: string]: any }>;
  [k: string]: any;
};

type LoginResponse = {
  message?: string;
  access_token: string;
  data: Customer;
};

const LOGIN_PATH = "/v1/auth/login/customer";

// ambil customer_id dari response API
function extractUid(u?: Customer | null): string {
  if (!u) return "";
  
  // Cek customer_id dari accounts array
  if (u.accounts && u.accounts.length > 0 && u.accounts[0].customer_id) {
    return String(u.accounts[0].customer_id);
  }
  
  // Fallback ke field lain
  const fallback = u.customer_id || u.id || u.customer?.customer_id || u.customer?.id;
  if (fallback) {
    return String(fallback);
  }
  
  // Jika tidak ada customer_id, gunakan email sebagai unique identifier
  if (u.email) {
    return u.email.split('@')[0]; // ambil bagian sebelum @
  }
  
  return "";
}

export function useAuth() {
  const [hydrated, setHydrated] = useState(false); // <-- penting
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<Customer | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const isAuthenticated = !!token;

  const uid = useMemo(() => extractUid(user), [user]);

  // load sesi awal
  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          AsyncStorage.getItem("access_token"),
          AsyncStorage.getItem("customer"),
        ]);

        if (t) setToken(t);
        if (u) {
          try {
            const userData: Customer = JSON.parse(u);
            setUser(userData);
            setTickets(userData.tickets || []);

          } catch {
            setUser(null);
            setTickets([]);
          }
        }
      } finally {
        setHydrated(true); // <-- tandai selesai rehydrate

      }
    })();
  }, []);

  const login = useCallback(
    async (emailOrUsername: string, password: string) => {
      if (!emailOrUsername || !password) {
        Alert.alert("Error", "Email/Username dan password harus diisi");
        return;
      }
      setIsLoading(true);

      
      try {
        // Clear old data first

        await AsyncStorage.multiRemove(["access_token", "customer", "isLoggedIn"]);
        setToken(null);
        setUser(null);
        setTickets([]);
        
        // backend kamu menerima { email, password }
        const res = await api<LoginResponse>(LOGIN_PATH, {
          method: "POST",
          body: JSON.stringify({ email: emailOrUsername, password }),
        });



        if (!res?.access_token || !res?.data) {
          throw new Error("Respon login tidak lengkap");
        }
        
        const newUid = extractUid(res.data);

        
        if (!newUid) {

          throw new Error("Customer ID tidak ditemukan dalam response");
        }
        
        // Set new data
        await AsyncStorage.multiSet([
          ["access_token", res.access_token],
          ["customer", JSON.stringify(res.data)],
          ["isLoggedIn", "true"],
        ]);

        setToken(res.access_token);
        setUser(res.data);
        setTickets(res.data.tickets || []);
        

        
        // Navigate immediately after successful login
        router.replace("/chat");
      } catch (error: any) {

        const msg =
          typeof error?.message === "string" &&
          (error.message.includes("401") ||
            /unauthorized|invalid/i.test(error.message))
            ? "Email/Username atau password salah"
            : error.message || "Gagal login. Periksa koneksi atau coba lagi.";
        Alert.alert("Login gagal", msg);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([
        "access_token",
        "customer",
        "isLoggedIn",
      ]);
      setToken(null);
      setUser(null);
      setTickets([]);
      router.replace("/");
    } catch (error) {
      console.error("Error during logout:", error);
    }
  }, []);

  return {
    login,
    logout,
    isLoading,
    isAuthenticated,
    user,
    token,
    tickets,
    uid,
    hydrated,
  };
}
