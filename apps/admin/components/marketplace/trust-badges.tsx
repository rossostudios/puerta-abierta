import { SecurityCheckIcon, Tick01Icon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";

type TrustBadgesProps = {
  isTransparent: boolean;
  isEn: boolean;
};

export function TrustBadges({ isTransparent, isEn }: TrustBadgesProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {isTransparent ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <Icon icon={Tick01Icon} size={12} />
          {isEn ? "Transparent pricing" : "Precios transparentes"}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
        <Icon icon={SecurityCheckIcon} size={12} />
        {isEn ? "Verified listing" : "Anuncio verificado"}
      </span>
    </div>
  );
}
