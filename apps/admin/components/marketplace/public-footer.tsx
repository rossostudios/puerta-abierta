import {
  Facebook01Icon,
  InstagramIcon,
  Mail01Icon,
  NewTwitterIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";

import { CasaoraLogo } from "@/components/ui/casaora-logo";
import { Icon } from "@/components/ui/icon";

const POPULAR_CITIES = [
  { label: "Asunción", param: "Asuncion" },
  { label: "Ciudad del Este", param: "Ciudad del Este" },
  { label: "Encarnación", param: "Encarnacion" },
  { label: "Luque", param: "Luque" },
  { label: "San Lorenzo", param: "San Lorenzo" },
];

const SOCIAL_LINKS = [
  { icon: InstagramIcon, label: "Instagram", href: "#" },
  { icon: Facebook01Icon, label: "Facebook", href: "#" },
  { icon: NewTwitterIcon, label: "X", href: "#" },
] as const;

export function PublicFooter({ locale }: { locale: "es-PY" | "en-US" }) {
  const isEn = locale === "en-US";

  return (
    <footer className="mt-14 bg-[#1a1a1a]">
      <div className="mx-auto w-full max-w-[1560px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <CasaoraLogo className="inline-flex" size={28} />
              <span className="font-bold text-[#faf8f5] text-lg tracking-tight">
                CASAORA
              </span>
            </div>
            <p className="font-serif text-[#faf8f5]/50 text-sm italic">
              {isEn
                ? "Where transparency meets home."
                : "Donde la transparencia encuentra hogar."}
            </p>
            <p className="max-w-xs text-[#faf8f5]/60 text-sm leading-relaxed">
              {isEn
                ? "Transparent long-term rental marketplace for Paraguay — designed for locals, expats, and investors."
                : "Marketplace transparente de alquileres a largo plazo en Paraguay — para locales, expatriados e inversores."}
            </p>
            <div className="flex items-center gap-3 pt-2">
              {SOCIAL_LINKS.map((social) => (
                <a
                  aria-label={social.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#faf8f5]/40 transition-colors hover:text-[#faf8f5]/80"
                  href={social.href}
                  key={social.label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon icon={social.icon} size={17} />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="font-medium font-serif text-[#faf8f5]/80 text-sm">
              {isEn ? "Quick Links" : "Enlaces"}
            </h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link
                  className="text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="/"
                >
                  {isEn ? "Home" : "Inicio"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="/marketplace"
                >
                  {isEn ? "All listings" : "Todos los anuncios"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="/marketplace#how-it-works"
                >
                  {isEn ? "How it works" : "Cómo funciona"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="/login"
                >
                  {isEn ? "Agency login" : "Ingreso agencias"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Popular Cities */}
          <div className="space-y-4">
            <h3 className="font-medium font-serif text-[#faf8f5]/80 text-sm">
              {isEn ? "Popular Cities" : "Ciudades populares"}
            </h3>
            <ul className="space-y-2.5 text-sm">
              {POPULAR_CITIES.map((city) => (
                <li key={city.param}>
                  <Link
                    className="text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                    href={`/marketplace?city=${encodeURIComponent(city.param)}`}
                  >
                    {city.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h3 className="font-medium font-serif text-[#faf8f5]/80 text-sm">
              {isEn ? "Contact" : "Contacto"}
            </h3>
            <p className="text-[#faf8f5]/50 text-sm">
              {isEn
                ? "Questions? We're here to help."
                : "¿Preguntas? Estamos para ayudarte."}
            </p>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a
                  className="inline-flex items-center gap-2 text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="https://wa.me/595981000000"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon icon={WhatsappIcon} size={15} />
                  WhatsApp
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-2 text-[#faf8f5]/50 transition-colors hover:text-[#faf8f5]/80"
                  href="mailto:info@casaora.co"
                >
                  <Icon icon={Mail01Icon} size={15} />
                  info@casaora.co
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-[#faf8f5]/10 border-t pt-8 sm:flex-row">
          <p className="text-[#faf8f5]/40 text-xs">
            &copy; {new Date().getFullYear()} Casaora.{" "}
            {isEn ? "All rights reserved." : "Todos los derechos reservados."}
          </p>
          <div className="flex items-center gap-5 text-[#faf8f5]/40 text-xs">
            <Link
              className="transition-colors hover:text-[#faf8f5]/60"
              href="/privacy"
            >
              {isEn ? "Privacy Policy" : "Política de privacidad"}
            </Link>
            <Link
              className="transition-colors hover:text-[#faf8f5]/60"
              href="/terms"
            >
              {isEn ? "Terms of Service" : "Términos de servicio"}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
