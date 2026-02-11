import { proxyMarketplaceRequest } from "../../../_shared";

type Params = {
  params: Promise<{ slug: string }>;
};

export async function POST(_request: Request, context: Params) {
  const { slug } = await context.params;
  const encodedSlug = encodeURIComponent(slug);
  return proxyMarketplaceRequest(
    `/public/marketplace/listings/${encodedSlug}/contact-whatsapp`,
    {
      method: "POST",
    }
  );
}
