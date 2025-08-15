import axios from "axios";
// ganti IP di bawah sesuai LAN kamu saat pakai server lokal
export const http = axios.create({
  baseURL: "http://192.168.226.76:4000",
  timeout: 15000,
});
