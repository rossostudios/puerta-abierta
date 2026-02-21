export type ReviewRow = {
  id: string;
  guest_name?: string | null;
  platform: string;
  rating?: number | null;
  review_text?: string | null;
  response_text?: string | null;
  response_status: string;
  ai_suggested_response?: string | null;
  responded_at?: string | null;
  review_date?: string | null;
  property_name?: string | null;
  created_at?: string | null;
};
