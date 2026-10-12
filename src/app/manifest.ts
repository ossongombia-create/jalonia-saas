// Manifeste d'application : rend Jalonia « installable ». Depuis le navigateur (ordinateur ou téléphone),
// l'utilisateur ajoute une icône « Jalonia » sur son bureau ou son écran d'accueil et l'ouvre d'un clic.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Jalonia",
    short_name: "Jalonia",
    description: "Documentation des processus selon le langage Qualigramme",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f1eef4",
    theme_color: "#005a70",
    icons: [
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icones/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icones/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
