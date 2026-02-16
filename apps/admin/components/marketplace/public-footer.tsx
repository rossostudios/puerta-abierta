import {
  Facebook01Icon,
  InstagramIcon,
  Mail01Icon,
  NewTwitterIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { StoaLogo } from "@/components/ui/stoa-logo";

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
    <footer className="mt-10 border-border/70 border-t bg-muted/30">
      <div className="mx-auto w-full max-w-[1560px] px-3 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StoaLogo className="text-primary" size={20} />
              <span className="font-semibold tracking-tight">Stoa</span>
            </div>
            <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
              {isEn
                ? "Transparent long-term rental marketplace for Paraguay — designed for locals, expats, and investors."
                : "Marketplace transparente de alquileres a largo plazo en Paraguay — para locales, expatriados e inversores."}
            </p>
            <div className="flex items-center gap-2 pt-1">
              {SOCIAL_LINKS.map((social) => (
                <a
                  aria-label={social.label}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card/80 text-muted-foreground transition-colors hover:text-foreground"
                  href={social.href}
                  key={social.label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon icon={social.icon} size={15} />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              {isEn ? "Quick Links" : "Enlaces"}
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  href="/"
                >
                  {isEn ? "Home" : "Inicio"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  href="/marketplace"
                >
                  {isEn ? "All listings" : "Todos los anuncios"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  href="/marketplace#how-it-works"
                >
                  {isEn ? "How it works" : "Cómo funciona"}
                </Link>
              </li>
              <li>
                <Link
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  href="/login"
                >
                  {isEn ? "Agency login" : "Ingreso agencias"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Popular Cities */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              {isEn ? "Popular Cities" : "Ciudades populares"}
            </h3>
            <ul className="space-y-2 text-sm">
              {POPULAR_CITIES.map((city) => (
                <li key={city.param}>
                  <Link
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    href={`/marketplace?city=${encodeURIComponent(city.param)}`}
                  >
                    {city.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              {isEn ? "Contact" : "Contacto"}
            </h3>
            <p className="text-muted-foreground text-sm">
              {isEn ? "Questions? We're here to help." : "¿Preguntas? Estamos para ayudarte."}
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  href="https://wa.me/595981000000"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon icon={WhatsappIcon} size={14} />
                  WhatsApp
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  href="mailto:info@stoa.com.py"
                >
                  <Icon icon={Mail01Icon} size={14} />
                  info@stoa.com.py
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-border/60 border-t pt-6 sm:flex-row">
          <p className="text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Stoa.{" "}
            {isEn ? "All rights reserved." : "Todos los derechos reservados."}
          </p>
          <div className="flex items-center gap-4 text-muted-foreground text-xs">
            <a className="transition-colors hover:text-foreground" href="#">
              {isEn ? "Privacy Policy" : "Política de privacidad"}
            </a>
            <a className="transition-colors hover:text-foreground" href="#">
              {isEn ? "Terms of Service" : "Términos de servicio"}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
