// Adresse IP du visiteur. L'application écoute UNIQUEMENT sur 127.0.0.1, derrière Caddy, qui remplace
// l'en-tête X-Forwarded-For par l'adresse réelle du client : la première valeur est donc fiable.
import { ipValide } from "../audit/journal";

export function ipDepuisEntetes(entetes: Headers): string | null {
  const transmise = entetes.get("x-forwarded-for")?.split(",")[0];
  return ipValide(transmise) ?? ipValide(entetes.get("x-real-ip"));
}

export function agentDepuisEntetes(entetes: Headers): string | null {
  const agent = entetes.get("user-agent");
  return agent ? agent.slice(0, 500) : null;
}
