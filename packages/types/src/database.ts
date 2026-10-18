export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };

  private: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      booking_records: {
        Row: {
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_key: string | null;
          checkout_request_hash: string | null;
          commission_cents: number | null;
          commission_rate_bps: number | null;
          confirmed_at: string | null;
          created_at: string | null;
          currency: string | null;
          customer_city: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_notes: string | null;
          customer_postal_code: string | null;
          dispute_amount_cents: number | null;
          dispute_closed_at: string | null;
          dispute_evidence_due_by: string | null;
          dispute_outcome: string | null;
          dispute_reason: string | null;
          disputed_at: string | null;
          ends_at: string | null;
          id: string | null;
          kind: string | null;
          listing_id: string | null;
          party_size: number | null;
          payout_due_at: string | null;
          payout_failed_at: string | null;
          payout_failure: string | null;
          payout_held_at: string | null;
          payout_hold: string | null;
          payout_holds_released: string[] | null;
          problem_note: string | null;
          problem_reported_at: string | null;
          problem_resolution: string | null;
          problem_resolved_at: string | null;
          provider_amount_cents: number | null;
          provider_id: string | null;
          refunded_at: string | null;
          refunded_cents: number | null;
          reserved_until: string | null;
          respond_by: string | null;
          reversal_failed_at: string | null;
          reversal_failure: string | null;
          service_mode: string | null;
          session_id: string | null;
          starts_at: string | null;
          status: string | null;
          status_changed_by: string | null;
          stripe_charge_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_dispute_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_transfer_id: string | null;
          stripe_transfer_reversal_id: string | null;
          total_cents: number | null;
          unit_price_cents: number | null;
          updated_at: string | null;
        };
        ComputedFields: never;
        Update: {
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checkout_key?: string | null;
          checkout_request_hash?: string | null;
          commission_cents?: number | null;
          commission_rate_bps?: number | null;
          confirmed_at?: string | null;
          created_at?: string | null;
          currency?: string | null;
          customer_city?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_notes?: string | null;
          customer_postal_code?: string | null;
          dispute_amount_cents?: number | null;
          dispute_closed_at?: string | null;
          dispute_evidence_due_by?: string | null;
          dispute_outcome?: string | null;
          dispute_reason?: string | null;
          disputed_at?: string | null;
          ends_at?: string | null;
          id?: string | null;
          kind?: string | null;
          listing_id?: string | null;
          party_size?: number | null;
          payout_due_at?: string | null;
          payout_failed_at?: string | null;
          payout_failure?: string | null;
          payout_held_at?: string | null;
          payout_hold?: string | null;
          payout_holds_released?: string[] | null;
          problem_note?: string | null;
          problem_reported_at?: string | null;
          problem_resolution?: string | null;
          problem_resolved_at?: string | null;
          provider_amount_cents?: number | null;
          provider_id?: string | null;
          refunded_at?: string | null;
          refunded_cents?: number | null;
          reserved_until?: string | null;
          respond_by?: string | null;
          reversal_failed_at?: string | null;
          reversal_failure?: string | null;
          service_mode?: string | null;
          session_id?: string | null;
          starts_at?: string | null;
          status?: string | null;
          status_changed_by?: string | null;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_dispute_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_transfer_id?: string | null;
          stripe_transfer_reversal_id?: string | null;
          total_cents?: number | null;
          unit_price_cents?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string;
          admin_id: string | null;
          created_at: string;
          id: string;
          message: string | null;
          reason: string | null;
          rule: string | null;
          target: string;
          target_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          message?: string | null;
          reason?: string | null;
          rule?: string | null;
          target: string;
          target_id: string;
        };
        Update: {
          action?: string;
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          message?: string | null;
          reason?: string | null;
          rule?: string | null;
          target?: string;
          target_id?: string;
        };
        Relationships: [];
      };
      admin_notifications: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          read_at: string | null;
          recipient_id: string;
          report_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          read_at?: string | null;
          recipient_id: string;
          report_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          read_at?: string | null;
          recipient_id?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_notifications_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_addresses: {
        Row: {
          booking_id: string;
          city: string;
          instructions: string | null;
          line1: string;
          line2: string | null;
          postal_code: string;
          state: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          city: string;
          instructions?: string | null;
          line1: string;
          line2?: string | null;
          postal_code: string;
          state: string;
        };
        Update: {
          booking_id?: string;
          city?: string;
          instructions?: string | null;
          line1?: string;
          line2?: string | null;
          postal_code?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_addresses_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_contacts: {
        Row: {
          booking_id: string;
          email: string;
          phone: string | null;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          email: string;
          phone?: string | null;
        };
        Update: {
          booking_id?: string;
          email?: string;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_contacts_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_emails: {
        Row: {
          attempts: number;
          booking_id: string;
          created_at: string;
          id: string;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          next_attempt_at: string;
          recipient: string;
          resend_id: string | null;
          sent_at: string | null;
          skip_reason: string | null;
          status: string;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          booking_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          last_error?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          recipient?: never;
          resend_id?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Update: {
          attempts?: number;
          booking_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          recipient?: never;
          resend_id?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_emails_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_events: {
        Row: {
          actor: string;
          booking_id: string;
          created_at: string;
          from_status: string | null;
          id: string;
          to_status: string;
        };
        ComputedFields: never;
        Insert: {
          actor: string;
          booking_id: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          to_status: string;
        };
        Update: {
          actor?: string;
          booking_id?: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_finances: {
        Row: {
          booking_id: string;
          commission_cents: number;
          commission_rate_bps: number;
          dispute_amount_cents: number | null;
          dispute_closed_at: string | null;
          dispute_evidence_due_by: string | null;
          dispute_outcome: string | null;
          dispute_reason: string | null;
          disputed_at: string | null;
          payout_failed_at: string | null;
          payout_failure: string | null;
          payout_held_at: string | null;
          payout_hold: string | null;
          payout_holds_released: string[];
          provider_amount_cents: number;
          reversal_failed_at: string | null;
          reversal_failure: string | null;
          stripe_charge_id: string | null;
          stripe_checkout_session_id: string | null;
          stripe_dispute_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_transfer_id: string | null;
          stripe_transfer_reversal_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          commission_cents: number;
          commission_rate_bps: number;
          dispute_amount_cents?: number | null;
          dispute_closed_at?: string | null;
          dispute_evidence_due_by?: string | null;
          dispute_outcome?: string | null;
          dispute_reason?: string | null;
          disputed_at?: string | null;
          payout_failed_at?: string | null;
          payout_failure?: string | null;
          payout_held_at?: string | null;
          payout_hold?: string | null;
          payout_holds_released?: string[];
          provider_amount_cents: number;
          reversal_failed_at?: string | null;
          reversal_failure?: string | null;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_dispute_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_transfer_id?: string | null;
          stripe_transfer_reversal_id?: string | null;
        };
        Update: {
          booking_id?: string;
          commission_cents?: number;
          commission_rate_bps?: number;
          dispute_amount_cents?: number | null;
          dispute_closed_at?: string | null;
          dispute_evidence_due_by?: string | null;
          dispute_outcome?: string | null;
          dispute_reason?: string | null;
          disputed_at?: string | null;
          payout_failed_at?: string | null;
          payout_failure?: string | null;
          payout_held_at?: string | null;
          payout_hold?: string | null;
          payout_holds_released?: string[];
          provider_amount_cents?: number;
          reversal_failed_at?: string | null;
          reversal_failure?: string | null;
          stripe_charge_id?: string | null;
          stripe_checkout_session_id?: string | null;
          stripe_dispute_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_transfer_id?: string | null;
          stripe_transfer_reversal_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_finances_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_reports: {
        Row: {
          booking_id: string;
          created_at: string;
          note: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id: string;
          created_at?: string;
          note: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          note?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_reports_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_key: string | null;
          checkout_request_hash: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          customer_city: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes: string | null;
          customer_postal_code: string | null;
          ends_at: string | null;
          id: string;
          kind: string;
          listing_id: string;
          party_size: number;
          payout_due_at: string | null;
          problem_reported_at: string | null;
          problem_resolution: string | null;
          problem_resolved_at: string | null;
          provider_id: string;
          refunded_at: string | null;
          refunded_cents: number;
          reserved_until: string | null;
          respond_by: string | null;
          service_mode: string | null;
          session_id: string | null;
          starts_at: string | null;
          status: string;
          status_changed_by: string;
          total_cents: number;
          unit_price_cents: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checkout_key?: string | null;
          checkout_request_hash?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          customer_city?: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes?: string | null;
          customer_postal_code?: string | null;
          ends_at?: string | null;
          id?: string;
          kind: string;
          listing_id: string;
          party_size?: number;
          payout_due_at?: string | null;
          problem_reported_at?: string | null;
          problem_resolution?: string | null;
          problem_resolved_at?: string | null;
          provider_id: string;
          refunded_at?: string | null;
          refunded_cents?: number;
          reserved_until?: string | null;
          respond_by?: string | null;
          service_mode?: string | null;
          session_id?: string | null;
          starts_at?: string | null;
          status?: string;
          status_changed_by?: string;
          total_cents: number;
          unit_price_cents: number;
          updated_at?: string;
        };
        Update: {
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checkout_key?: string | null;
          checkout_request_hash?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          customer_city?: string | null;
          customer_id?: string;
          customer_name?: string;
          customer_notes?: string | null;
          customer_postal_code?: string | null;
          ends_at?: string | null;
          id?: string;
          kind?: string;
          listing_id?: string;
          party_size?: number;
          payout_due_at?: string | null;
          problem_reported_at?: string | null;
          problem_resolution?: string | null;
          problem_resolved_at?: string | null;
          provider_id?: string;
          refunded_at?: string | null;
          refunded_cents?: number;
          reserved_until?: string | null;
          respond_by?: string | null;
          service_mode?: string | null;
          session_id?: string | null;
          starts_at?: string | null;
          status?: string;
          status_changed_by?: string;
          total_cents?: number;
          unit_price_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "experience_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          kind: string;
          name: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          kind: string;
          name: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      cities: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          slug: string;
          sort_order: number;
          state: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          sort_order?: number;
          state: string;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
          state?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      commission_rate_changes: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          id: string;
          kind: string;
          new_rate_bps: number;
          old_rate_bps: number;
        };
        ComputedFields: never;
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          kind: string;
          new_rate_bps: number;
          old_rate_bps: number;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          kind?: string;
          new_rate_bps?: number;
          old_rate_bps?: number;
        };
        Relationships: [];
      };
      commission_rates: {
        Row: {
          kind: string;
          rate_bps: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          kind: string;
          rate_bps: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          kind?: string;
          rate_bps?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      experience_sessions: {
        Row: {
          capacity: number;
          created_at: string;
          id: string;
          listing_id: string;
          starts_at: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          capacity: number;
          created_at?: string;
          id?: string;
          listing_id: string;
          starts_at: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          capacity?: number;
          created_at?: string;
          id?: string;
          listing_id?: string;
          starts_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "experience_sessions_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      guide_ai_drafts: {
        Row: {
          area_id: string | null;
          category_id: string | null;
          cost_usd: number | null;
          created_at: string;
          error: string | null;
          guide_id: string | null;
          id: string;
          input_tokens: number | null;
          model: string;
          notes: string | null;
          output_tokens: number | null;
          previous_draft: Json | null;
          previous_draft_restored_at: string | null;
          reply: Json | null;
          requested_by: string | null;
          topic: string;
        };
        ComputedFields: never;
        Insert: {
          area_id?: string | null;
          category_id?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          guide_id?: string | null;
          id?: string;
          input_tokens?: number | null;
          model: string;
          notes?: string | null;
          output_tokens?: number | null;
          previous_draft?: Json | null;
          previous_draft_restored_at?: string | null;
          reply?: Json | null;
          requested_by?: string | null;
          topic: string;
        };
        Update: {
          area_id?: string | null;
          category_id?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          guide_id?: string | null;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          notes?: string | null;
          output_tokens?: number | null;
          previous_draft?: Json | null;
          previous_draft_restored_at?: string | null;
          reply?: Json | null;
          requested_by?: string | null;
          topic?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guide_ai_drafts_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guide_ai_drafts_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guide_ai_drafts_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "guides";
            referencedColumns: ["id"];
          },
        ];
      };
      guide_photos: {
        Row: {
          alt_text: string;
          card_path: string | null;
          commercial_use_confirmed: boolean;
          created_at: string;
          credit_name: string | null;
          credit_url: string | null;
          guide_id: string;
          height: number;
          id: string;
          licence: string | null;
          source: string;
          source_url: string | null;
          storage_path: string;
          width: number;
          public_guide_photo_json: Json | null;
        };
        ComputedFields: "public_guide_photo_json";
        Insert: {
          alt_text: string;
          card_path?: string | null;
          commercial_use_confirmed?: boolean;
          created_at?: string;
          credit_name?: string | null;
          credit_url?: string | null;
          guide_id: string;
          height: number;
          id?: string;
          licence?: string | null;
          source: string;
          source_url?: string | null;
          storage_path: string;
          width: number;
        };
        Update: {
          alt_text?: string;
          card_path?: string | null;
          commercial_use_confirmed?: boolean;
          created_at?: string;
          credit_name?: string | null;
          credit_url?: string | null;
          guide_id?: string;
          height?: number;
          id?: string;
          licence?: string | null;
          source?: string;
          source_url?: string | null;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "guide_photos_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "guides";
            referencedColumns: ["id"];
          },
        ];
      };
      guide_versions: {
        Row: {
          area_id: string | null;
          body: NonNullable<Json>;
          category_id: string | null;
          cover_photo_id: string | null;
          guide_id: string;
          id: string;
          listing_kind: string | null;
          published_at: string;
          published_by: string | null;
          teaser: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          area_id?: string | null;
          body: NonNullable<Json>;
          category_id?: string | null;
          cover_photo_id?: string | null;
          guide_id: string;
          id?: string;
          listing_kind?: string | null;
          published_at?: string;
          published_by?: string | null;
          teaser: string;
          title: string;
        };
        Update: {
          area_id?: string | null;
          body?: NonNullable<Json>;
          category_id?: string | null;
          cover_photo_id?: string | null;
          guide_id?: string;
          id?: string;
          listing_kind?: string | null;
          published_at?: string;
          published_by?: string | null;
          teaser?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guide_versions_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guide_versions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guide_versions_cover_photo_id_fkey";
            columns: ["cover_photo_id"];
            isOneToOne: false;
            referencedRelation: "guide_photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guide_versions_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "guides";
            referencedColumns: ["id"];
          },
        ];
      };
      guides: {
        Row: {
          ai_draft_pending_review: boolean;
          ai_reviewed_at: string | null;
          ai_reviewed_by: string | null;
          area_id: string | null;
          body: Json | null;
          category_id: string | null;
          content_updated_at: string | null;
          cover_photo_id: string | null;
          created_at: string;
          created_by: string | null;
          draft_area_id: string | null;
          draft_body: NonNullable<Json>;
          draft_category_id: string | null;
          draft_cover_photo_id: string | null;
          draft_listing_kind: string | null;
          draft_teaser: string;
          draft_title: string;
          id: string;
          listing_kind: string | null;
          market_id: string;
          published_at: string | null;
          slug: string;
          status: string;
          teaser: string | null;
          title: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          ai_draft_pending_review?: boolean;
          ai_reviewed_at?: string | null;
          ai_reviewed_by?: string | null;
          area_id?: string | null;
          body?: Json | null;
          category_id?: string | null;
          content_updated_at?: string | null;
          cover_photo_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          draft_area_id?: string | null;
          draft_body?: NonNullable<Json>;
          draft_category_id?: string | null;
          draft_cover_photo_id?: string | null;
          draft_listing_kind?: string | null;
          draft_teaser?: string;
          draft_title?: string;
          id?: string;
          listing_kind?: string | null;
          market_id: string;
          published_at?: string | null;
          slug: string;
          status?: string;
          teaser?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          ai_draft_pending_review?: boolean;
          ai_reviewed_at?: string | null;
          ai_reviewed_by?: string | null;
          area_id?: string | null;
          body?: Json | null;
          category_id?: string | null;
          content_updated_at?: string | null;
          cover_photo_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          draft_area_id?: string | null;
          draft_body?: NonNullable<Json>;
          draft_category_id?: string | null;
          draft_cover_photo_id?: string | null;
          draft_listing_kind?: string | null;
          draft_teaser?: string;
          draft_title?: string;
          id?: string;
          listing_kind?: string | null;
          market_id?: string;
          published_at?: string | null;
          slug?: string;
          status?: string;
          teaser?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guides_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_cover_fk";
            columns: ["cover_photo_id"];
            isOneToOne: false;
            referencedRelation: "guide_photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_draft_area_id_fkey";
            columns: ["draft_area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_draft_category_id_fkey";
            columns: ["draft_category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_draft_cover_fk";
            columns: ["draft_cover_photo_id"];
            isOneToOne: false;
            referencedRelation: "guide_photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guides_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };
      homepage_features: {
        Row: {
          created_at: string;
          guide_id: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          guide_id: string;
          position: number;
        };
        Update: {
          created_at?: string;
          guide_id?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "homepage_features_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: true;
            referencedRelation: "guides";
            referencedColumns: ["id"];
          },
        ];
      };
      job_runs: {
        Row: {
          changed: number;
          checked: number;
          error: string | null;
          failed: number;
          failures: string[];
          finished_at: string;
          id: string;
          job: string;
          more_waiting: boolean;
          started_at: string;
        };
        ComputedFields: never;
        Insert: {
          changed?: number;
          checked?: number;
          error?: string | null;
          failed?: number;
          failures?: string[];
          finished_at?: string;
          id?: string;
          job: string;
          more_waiting?: boolean;
          started_at: string;
        };
        Update: {
          changed?: number;
          checked?: number;
          error?: string | null;
          failed?: number;
          failures?: string[];
          finished_at?: string;
          id?: string;
          job?: string;
          more_waiting?: boolean;
          started_at?: string;
        };
        Relationships: [];
      };
      listing_addresses: {
        Row: {
          city: string;
          created_at: string;
          instructions: string | null;
          line1: string;
          line2: string | null;
          listing_id: string;
          postal_code: string;
          state: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          city: string;
          created_at?: string;
          instructions?: string | null;
          line1: string;
          line2?: string | null;
          listing_id: string;
          postal_code: string;
          state: string;
          updated_at?: string;
        };
        Update: {
          city?: string;
          created_at?: string;
          instructions?: string | null;
          line1?: string;
          line2?: string | null;
          listing_id?: string;
          postal_code?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_addresses_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_photos: {
        Row: {
          alt_text: string;
          card_path: string | null;
          created_at: string;
          id: string;
          listing_id: string;
          position: number;
          storage_path: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alt_text: string;
          card_path?: string | null;
          created_at?: string;
          id?: string;
          listing_id: string;
          position: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          alt_text?: string;
          card_path?: string | null;
          created_at?: string;
          id?: string;
          listing_id?: string;
          position?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_ratings: {
        Row: {
          listing_id: string;
          rating_average: number | null;
          rating_total: number;
          review_count: number;
          stars_1: number;
          stars_2: number;
          stars_3: number;
          stars_4: number;
          stars_5: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          listing_id: string;
          rating_average?: never;
          rating_total?: number;
          review_count?: number;
          stars_1?: number;
          stars_2?: number;
          stars_3?: number;
          stars_4?: number;
          stars_5?: number;
          updated_at?: string;
        };
        Update: {
          listing_id?: string;
          rating_average?: never;
          rating_total?: number;
          review_count?: number;
          stars_1?: number;
          stars_2?: number;
          stars_3?: number;
          stars_4?: number;
          stars_5?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_ratings_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_service_areas: {
        Row: {
          created_at: string;
          listing_id: string;
          service_area_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          listing_id: string;
          service_area_id: string;
        };
        Update: {
          created_at?: string;
          listing_id?: string;
          service_area_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_service_areas_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_service_areas_service_area_id_fkey";
            columns: ["service_area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
        ];
      };
      listings: {
        Row: {
          area_id: string | null;
          booking_mode: string | null;
          buffer_minutes: number | null;
          category_id: string;
          city_id: string;
          created_at: string;
          currency: string;
          description: string;
          duration_minutes: number | null;
          id: string;
          kind: string;
          location_mode: string | null;
          price_cents: number;
          provider_id: string;
          published_at: string | null;
          rejection_reason: string | null;
          reviewed_at: string | null;
          slug: string;
          status: string;
          submitted_at: string | null;
          title: string;
          unpublished_reason: string | null;
          updated_at: string;
          hold_buffer: string | null;
        };
        ComputedFields: "hold_buffer";
        Insert: {
          area_id?: string | null;
          booking_mode?: string | null;
          buffer_minutes?: number | null;
          category_id: string;
          city_id: string;
          created_at?: string;
          currency?: string;
          description: string;
          duration_minutes?: number | null;
          id?: string;
          kind: string;
          location_mode?: string | null;
          price_cents: number;
          provider_id: string;
          published_at?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          slug: string;
          status?: string;
          submitted_at?: string | null;
          title: string;
          unpublished_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          area_id?: string | null;
          booking_mode?: string | null;
          buffer_minutes?: number | null;
          category_id?: string;
          city_id?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          duration_minutes?: number | null;
          id?: string;
          kind?: string;
          location_mode?: string | null;
          price_cents?: number;
          provider_id?: string;
          published_at?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          slug?: string;
          status?: string;
          submitted_at?: string | null;
          title?: string;
          unpublished_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listings_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "service_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_category_id_kind_fkey";
            columns: ["category_id", "kind"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "kind"];
          },
          {
            foreignKeyName: "listings_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          booking_id: string | null;
          created_at: string;
          id: string;
          kind: string;
          listing_id: string | null;
          provider_id: string;
          read_at: string | null;
          support_report_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          listing_id?: string | null;
          provider_id: string;
          read_at?: string | null;
          support_report_id?: string | null;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          listing_id?: string | null;
          provider_id?: string;
          read_at?: string | null;
          support_report_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_support_report_id_fkey";
            columns: ["support_report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_date_hours: {
        Row: {
          created_at: string;
          ends: string;
          id: string;
          on_date: string;
          provider_id: string;
          starts: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          ends: string;
          id?: string;
          on_date: string;
          provider_id: string;
          starts: string;
        };
        Update: {
          created_at?: string;
          ends?: string;
          id?: string;
          on_date?: string;
          provider_id?: string;
          starts?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_date_hours_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_emails: {
        Row: {
          admin_action_id: string;
          attempts: number;
          created_at: string;
          id: string;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          message: string | null;
          next_attempt_at: string;
          provider_id: string;
          removed: string[] | null;
          resend_id: string | null;
          rule: string | null;
          sent_at: string | null;
          skip_reason: string | null;
          status: string;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          admin_action_id: string;
          attempts?: number;
          created_at?: string;
          id?: string;
          kind: string;
          last_error?: string | null;
          locked_at?: string | null;
          message?: string | null;
          next_attempt_at?: string;
          provider_id: string;
          removed?: string[] | null;
          resend_id?: string | null;
          rule?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Update: {
          admin_action_id?: string;
          attempts?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          message?: string | null;
          next_attempt_at?: string;
          provider_id?: string;
          removed?: string[] | null;
          resend_id?: string | null;
          rule?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_emails_admin_action_id_fkey";
            columns: ["admin_action_id"];
            isOneToOne: true;
            referencedRelation: "admin_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_emails_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_holds: {
        Row: {
          booking_id: string | null;
          created_at: string;
          during: unknown;
          id: string;
          provider_id: string;
          session_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          during: unknown;
          id?: string;
          provider_id: string;
          session_id?: string | null;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          during?: unknown;
          id?: string;
          provider_id?: string;
          session_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "provider_holds_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_holds_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_holds_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "experience_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_ratings: {
        Row: {
          provider_id: string;
          rating_average: number | null;
          rating_total: number;
          review_count: number;
          stars_1: number;
          stars_2: number;
          stars_3: number;
          stars_4: number;
          stars_5: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          provider_id: string;
          rating_average?: never;
          rating_total?: number;
          review_count?: number;
          stars_1?: number;
          stars_2?: number;
          stars_3?: number;
          stars_4?: number;
          stars_5?: number;
          updated_at?: string;
        };
        Update: {
          provider_id?: string;
          rating_average?: never;
          rating_total?: number;
          review_count?: number;
          stars_1?: number;
          stars_2?: number;
          stars_3?: number;
          stars_4?: number;
          stars_5?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_ratings_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_schedules: {
        Row: {
          booking_window_days: number;
          created_at: string;
          default_buffer_minutes: number;
          min_notice_minutes: number;
          provider_id: string;
          slot_interval_minutes: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          booking_window_days?: number;
          created_at?: string;
          default_buffer_minutes?: number;
          min_notice_minutes?: number;
          provider_id: string;
          slot_interval_minutes?: number;
          updated_at?: string;
        };
        Update: {
          booking_window_days?: number;
          created_at?: string;
          default_buffer_minutes?: number;
          min_notice_minutes?: number;
          provider_id?: string;
          slot_interval_minutes?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_schedules_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_time_off: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          note: string | null;
          provider_id: string;
          starts_on: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          note?: string | null;
          provider_id: string;
          starts_on: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          note?: string | null;
          provider_id?: string;
          starts_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_time_off_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_weekly_hours: {
        Row: {
          created_at: string;
          ends: string;
          id: string;
          provider_id: string;
          starts: string;
          weekday: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          ends: string;
          id?: string;
          provider_id: string;
          starts: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          ends?: string;
          id?: string;
          provider_id?: string;
          starts?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "provider_weekly_hours_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      providers: {
        Row: {
          avatar_path: string | null;
          avatar_small_path: string | null;
          bio: string | null;
          city_id: string;
          cover_card_path: string | null;
          cover_path: string | null;
          created_at: string;
          display_name: string;
          headline: string | null;
          id: string;
          owner_id: string;
          slug: string;
          status: string;
          stripe_account_id: string | null;
          stripe_charges_enabled: boolean;
          stripe_details_submitted: boolean;
          stripe_payouts_enabled: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_path?: string | null;
          avatar_small_path?: string | null;
          bio?: string | null;
          city_id: string;
          cover_card_path?: string | null;
          cover_path?: string | null;
          created_at?: string;
          display_name: string;
          headline?: string | null;
          id?: string;
          owner_id: string;
          slug: string;
          status?: string;
          stripe_account_id?: string | null;
          stripe_charges_enabled?: boolean;
          stripe_details_submitted?: boolean;
          stripe_payouts_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          avatar_small_path?: string | null;
          bio?: string | null;
          city_id?: string;
          cover_card_path?: string | null;
          cover_path?: string | null;
          created_at?: string;
          display_name?: string;
          headline?: string | null;
          id?: string;
          owner_id?: string;
          slug?: string;
          status?: string;
          stripe_account_id?: string | null;
          stripe_charges_enabled?: boolean;
          stripe_details_submitted?: boolean;
          stripe_payouts_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "providers_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };
      review_replies: {
        Row: {
          body: string;
          created_at: string;
          edited_at: string | null;
          provider_id: string;
          removed_at: string | null;
          removed_reason: string | null;
          removed_rule: string | null;
          review_id: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          edited_at?: string | null;
          provider_id: string;
          removed_at?: string | null;
          removed_reason?: string | null;
          removed_rule?: string | null;
          review_id: string;
          status?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          edited_at?: string | null;
          provider_id?: string;
          removed_at?: string | null;
          removed_reason?: string | null;
          removed_rule?: string | null;
          review_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_replies_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_replies_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: true;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      review_reports: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          reporter_id: string;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          review_id: string;
          rule: string;
          status: string;
          target: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          reporter_id?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          review_id: string;
          rule: string;
          status?: string;
          target?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          reporter_id?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          review_id?: string;
          rule?: string;
          status?: string;
          target?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_reports_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          body: string;
          booking_id: string;
          booking_month: string;
          created_at: string;
          customer_id: string;
          edited_at: string | null;
          id: string;
          listing_id: string;
          provider_id: string;
          rating: number;
          removed_at: string | null;
          removed_reason: string | null;
          removed_rule: string | null;
          reviewer_name: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          booking_id: string;
          booking_month: string;
          created_at?: string;
          customer_id: string;
          edited_at?: string | null;
          id?: string;
          listing_id: string;
          provider_id: string;
          rating: number;
          removed_at?: string | null;
          removed_reason?: string | null;
          removed_rule?: string | null;
          reviewer_name: string;
          status?: string;
        };
        Update: {
          body?: string;
          booking_id?: string;
          booking_month?: string;
          created_at?: string;
          customer_id?: string;
          edited_at?: string | null;
          id?: string;
          listing_id?: string;
          provider_id?: string;
          rating?: number;
          removed_at?: string | null;
          removed_reason?: string | null;
          removed_rule?: string | null;
          reviewer_name?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_listings: {
        Row: {
          created_at: string;
          customer_id: string;
          listing_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id?: string;
          listing_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          listing_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_listings_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_providers: {
        Row: {
          created_at: string;
          customer_id: string;
          provider_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id?: string;
          provider_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          provider_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_providers_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      service_areas: {
        Row: {
          active: boolean;
          city_id: string;
          created_at: string;
          id: string;
          kind: string;
          name: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          city_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          city_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_areas_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };
      service_open_days: {
        Row: {
          first_at: string;
          last_at: string;
          listing_id: string;
          on_date: string;
          starts: string[];
        };
        ComputedFields: never;
        Insert: {
          first_at: string;
          last_at: string;
          listing_id: string;
          on_date: string;
          starts: string[];
        };
        Update: {
          first_at?: string;
          last_at?: string;
          listing_id?: string;
          on_date?: string;
          starts?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "service_open_days_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      service_open_days_pending: {
        Row: {
          provider_id: string;
          txid: unknown;
        };
        ComputedFields: never;
        Insert: {
          provider_id: string;
          txid?: unknown;
        };
        Update: {
          provider_id?: string;
          txid?: unknown;
        };
        Relationships: [];
      };
      service_open_days_refreshed: {
        Row: {
          covered_through: string;
          listing_id: string;
          notice: string;
          provider_id: string;
          refreshed_at: string;
        };
        ComputedFields: never;
        Insert: {
          covered_through: string;
          listing_id: string;
          notice: string;
          provider_id: string;
          refreshed_at: string;
        };
        Update: {
          covered_through?: string;
          listing_id?: string;
          notice?: string;
          provider_id?: string;
          refreshed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_open_days_refreshed_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_open_days_refreshed_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      support_emails: {
        Row: {
          admin_id: string | null;
          attempts: number;
          created_at: string;
          id: string;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          next_attempt_at: string;
          provider_id: string | null;
          report_id: string;
          resend_id: string | null;
          sent_at: string | null;
          skip_reason: string | null;
          status: string;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          admin_id?: string | null;
          attempts?: number;
          created_at?: string;
          id?: string;
          kind: string;
          last_error?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          provider_id?: string | null;
          report_id: string;
          resend_id?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Update: {
          admin_id?: string | null;
          attempts?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string;
          provider_id?: string | null;
          report_id?: string;
          resend_id?: string | null;
          sent_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_emails_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_emails_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          author_id: string | null;
          author_kind: string;
          body: string;
          created_at: string;
          id: string;
          report_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          author_kind?: string;
          body: string;
          created_at?: string;
          id?: string;
          report_id: string;
        };
        Update: {
          author_id?: string | null;
          author_kind?: string;
          body?: string;
          created_at?: string;
          id?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_messages_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      support_notes: {
        Row: {
          admin_id: string | null;
          body: string;
          created_at: string;
          id: string;
          report_id: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          report_id: string;
        };
        Update: {
          admin_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_notes_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      support_report_events: {
        Row: {
          actor: string;
          actor_id: string | null;
          created_at: string;
          from_status: string | null;
          id: string;
          report_id: string;
          to_status: string;
        };
        ComputedFields: never;
        Insert: {
          actor: string;
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          report_id: string;
          to_status: string;
        };
        Update: {
          actor?: string;
          actor_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          report_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_report_events_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      support_reports: {
        Row: {
          booking_id: string | null;
          category: string;
          created_at: string;
          description: string;
          follows_report_id: string | null;
          id: string;
          last_message_at: string;
          last_message_from: string;
          listing_id: string | null;
          provider_id: string;
          reporter_id: string | null;
          resolved_at: string | null;
          status: string;
          status_changed_at: string;
          status_changed_by: string;
          status_changed_by_id: string | null;
          updated_at: string;
          urgent: boolean | null;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          category: string;
          created_at?: string;
          description: string;
          follows_report_id?: string | null;
          id?: string;
          last_message_at?: string;
          last_message_from?: string;
          listing_id?: string | null;
          provider_id?: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          status?: string;
          status_changed_at?: string;
          status_changed_by?: string;
          status_changed_by_id?: string | null;
          updated_at?: string;
          urgent?: never;
        };
        Update: {
          booking_id?: string | null;
          category?: string;
          created_at?: string;
          description?: string;
          follows_report_id?: string | null;
          id?: string;
          last_message_at?: string;
          last_message_from?: string;
          listing_id?: string | null;
          provider_id?: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          status?: string;
          status_changed_at?: string;
          status_changed_by?: string;
          status_changed_by_id?: string | null;
          updated_at?: string;
          urgent?: never;
        };
        Relationships: [
          {
            foreignKeyName: "support_reports_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_reports_follows_report_id_fkey";
            columns: ["follows_report_id"];
            isOneToOne: false;
            referencedRelation: "support_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_reports_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_reports_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      active_category_ids: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      active_city_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      active_provider_ids: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      admin_ai_draft_cost: { Args: { p_since: string }; Returns: Json };
      admin_bookings_page: {
        Args: {
          p_attention?: string;
          p_desc?: boolean;
          p_from?: string;
          p_kind?: string;
          p_page?: number;
          p_page_size?: number;
          p_paid_from?: string;
          p_paid_to?: string;
          p_provider_id?: string;
          p_q?: string;
          p_sort?: string;
          p_status?: string;
          p_to?: string;
          p_with_attention?: boolean;
        };
        Returns: Json;
      };
      admin_cancel_booking: {
        Args: {
          p_admin_id: string;
          p_booking_id: string;
          p_cancelled_at: string;
          p_from: string;
          p_reason: string;
          p_refunded_cents: number;
          p_resolve_problem: boolean;
          p_reversal_failure: string;
          p_reversal_id: string;
        };
        Returns: string;
      };
      admin_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      admin_listings_page: {
        Args: {
          p_city_id?: string;
          p_desc?: boolean;
          p_kind: string;
          p_page?: number;
          p_page_size?: number;
          p_provider_id?: string;
          p_q?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      admin_moderate_review: {
        Args: {
          p_action: string;
          p_admin_id: string;
          p_reason: string;
          p_review_id: string;
          p_rule: string;
          p_target: string;
        };
        Returns: undefined;
      };
      admin_providers_page: {
        Args: {
          p_city_id?: string;
          p_desc?: boolean;
          p_page?: number;
          p_page_size?: number;
          p_paid_since?: string;
          p_payout_setup?: string;
          p_q?: string;
          p_sort?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      admin_release_payout: {
        Args: {
          p_admin_id: string;
          p_booking_id: string;
          p_hold: string;
          p_reason: string;
        };
        Returns: boolean;
      };
      admin_remove_provider_profile_content: {
        Args: {
          p_admin_id: string;
          p_message: string;
          p_parts: string[];
          p_provider_id: string;
          p_reason: string;
          p_rule: string;
        };
        Returns: string[];
      };
      admin_resolve_problem_paid: {
        Args: { p_admin_id: string; p_booking_id: string; p_reason: string };
        Returns: boolean;
      };
      admin_reviews_page: {
        Args: {
          p_page?: number;
          p_page_size?: number;
          p_provider_id?: string;
          p_rating?: number;
          p_reported?: boolean;
          p_status?: string;
        };
        Returns: Json;
      };
      admin_search_patterns: { Args: { p_q: string }; Returns: string[] };
      admin_set_homepage_features: {
        Args: { p_guide_ids: string[] };
        Returns: undefined;
      };
      admin_set_provider_status: {
        Args: {
          p_admin_id: string;
          p_message: string;
          p_provider_id: string;
          p_reason: string;
          p_status: string;
        };
        Returns: boolean;
      };
      admin_support_board: {
        Args: {
          p_category?: string;
          p_column?: string;
          p_done_days?: number;
          p_page?: number;
          p_page_size?: number;
          p_q?: string;
          p_urgent_only?: boolean;
        };
        Returns: Json;
      };
      admin_support_move: {
        Args: {
          p_admin_id: string;
          p_from?: string;
          p_report_id: string;
          p_to: string;
        };
        Returns: string;
      };
      admin_support_note: {
        Args: { p_admin_id: string; p_body: string; p_report_id: string };
        Returns: string;
      };
      admin_support_reply: {
        Args: {
          p_admin_id: string;
          p_body: string;
          p_report_id: string;
          p_wait?: boolean;
        };
        Returns: string;
      };
      assert_log_guards_on: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      booking_can_be_reviewed: {
        Args: { p_booking_id: string };
        Returns: boolean;
      };
      booking_emails_queue: {
        Args: { p_booking_id: string; p_kinds: string[] };
        Returns: undefined;
      };
      booking_money: {
        Args: { p_kind: string; p_party: number; p_unit_price: number };
        Returns: Record<string, unknown>;
      };
      create_service_booking: {
        Args: {
          p_address: Json;
          p_checkout_key?: string;
          p_customer_email: string;
          p_customer_id: string;
          p_customer_name: string;
          p_customer_notes: string;
          p_customer_phone: string;
          p_listing_id: string;
          p_request_hash?: string;
          p_reserved_until: string;
          p_starts_at: string;
        };
        Returns: {
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_key: string | null;
          checkout_request_hash: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          customer_city: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes: string | null;
          customer_postal_code: string | null;
          ends_at: string | null;
          id: string;
          kind: string;
          listing_id: string;
          party_size: number;
          payout_due_at: string | null;
          problem_reported_at: string | null;
          problem_resolution: string | null;
          problem_resolved_at: string | null;
          provider_id: string;
          refunded_at: string | null;
          refunded_cents: number;
          reserved_until: string | null;
          respond_by: string | null;
          service_mode: string | null;
          session_id: string | null;
          starts_at: string | null;
          status: string;
          status_changed_by: string;
          total_cents: number;
          unit_price_cents: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_active_provider_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_provider_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      has_contact_details: { Args: { p_text: string }; Returns: boolean };
      hold_buffer: {
        Args: {
          p_listing: Omit<
            Database["public"]["Tables"]["listings"]["Row"],
            Database["public"]["Tables"]["listings"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_time_zone: { Args: { p_name: string }; Returns: boolean };
      listing_parents_active: {
        Args: {
          p_category_id: string;
          p_city_id: string;
          p_provider_id: string;
        };
        Returns: boolean;
      };
      listing_sessions_page: {
        Args: {
          p_listing_id: string;
          p_page?: number;
          p_page_size?: number;
          p_past: boolean;
        };
        Returns: Json;
      };
      my_saved: { Args: Record<PropertyKey, never>; Returns: Json };
      my_service_slots_preview: {
        Args: { p_from: string; p_listing_id: string; p_to: string };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      my_support_reports: {
        Args: { p_page?: number; p_page_size?: number };
        Returns: Json;
      };
      provider_is_public: { Args: { p_provider_id: string }; Returns: boolean };
      provider_payout_setup: {
        Args: { p_account_id: string; p_charges: boolean; p_payouts: boolean };
        Returns: string;
      };
      provider_slug: { Args: { p_name: string }; Returns: string };
      public_browse: {
        Args: {
          p_area?: string;
          p_category?: string;
          p_from?: string;
          p_kind: string;
          p_market: string;
          p_page?: number;
          p_page_size?: number;
          p_to?: string;
        };
        Returns: Json;
      };
      public_category_counts: { Args: { p_market_id: string }; Returns: Json };
      public_guide: {
        Args: { p_market: string; p_slug: string };
        Returns: Json;
      };
      public_guide_photo_json: {
        Args: {
          p: Omit<
            Database["public"]["Tables"]["guide_photos"]["Row"],
            Database["public"]["Tables"]["guide_photos"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
      public_guides: { Args: { p_market: string }; Returns: Json };
      public_homepage_guides: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      public_provider_ids: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      publish_guide: {
        Args: { p_admin_id: string; p_guide_id: string };
        Returns: undefined;
      };
      queue_review_reminders: { Args: { p_now?: string }; Returns: number };
      recount_ratings: {
        Args: { p_listing_id: string; p_provider_id: string };
        Returns: undefined;
      };
      refresh_service_open_days: {
        Args: { p_provider_ids: string[] };
        Returns: undefined;
      };
      refresh_stale_service_open_days: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      reorder_listing_photos: {
        Args: { p_listing_id: string; p_photo_ids: string[] };
        Returns: undefined;
      };
      replace_date_hours: {
        Args: { p_date: string; p_hours: Json };
        Returns: number;
      };
      replace_weekly_hours: { Args: { p_hours: Json }; Returns: number };
      reserve_experience_booking: {
        Args: {
          p_checkout_key?: string;
          p_customer_email: string;
          p_customer_id: string;
          p_customer_name: string;
          p_customer_notes: string;
          p_customer_phone: string;
          p_party_size: number;
          p_request_hash?: string;
          p_reserved_until: string;
          p_session_id: string;
        };
        Returns: {
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_key: string | null;
          checkout_request_hash: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          customer_city: string | null;
          customer_id: string;
          customer_name: string;
          customer_notes: string | null;
          customer_postal_code: string | null;
          ends_at: string | null;
          id: string;
          kind: string;
          listing_id: string;
          party_size: number;
          payout_due_at: string | null;
          problem_reported_at: string | null;
          problem_resolution: string | null;
          problem_resolved_at: string | null;
          provider_id: string;
          refunded_at: string | null;
          refunded_cents: number;
          reserved_until: string | null;
          respond_by: string | null;
          service_mode: string | null;
          session_id: string | null;
          starts_at: string | null;
          status: string;
          status_changed_by: string;
          total_cents: number;
          unit_price_cents: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_display_name: { Args: { p_name: string }; Returns: string };
      review_reportable: {
        Args: { p_review_id: string; p_target: string };
        Returns: boolean;
      };
      review_state: { Args: { p_booking_id: string }; Returns: Json };
      review_window_open: { Args: { p_booking_id: string }; Returns: boolean };
      service_next_slot: {
        Args: { p_from?: string; p_listing_id: string };
        Returns: string;
      };
      service_open_matches: {
        Args: { p_from: string; p_ids: string[]; p_to: string };
        Returns: {
          first_at: string;
          first_day: string;
          listing_id: string;
        }[];
      };
      service_slots: {
        Args: { p_from: string; p_listing_id: string; p_to: string };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      service_slots_at: {
        Args: {
          p_from: string;
          p_listing_id: string;
          p_now: string;
          p_to: string;
        };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      service_slots_core: {
        Args: {
          p_from: string;
          p_listing_id: string;
          p_now: string;
          p_require_bookable: boolean;
          p_to: string;
        };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      service_slots_many: {
        Args: {
          p_from: string;
          p_ids: string[];
          p_now: string;
          p_require_bookable: boolean;
          p_to: string;
        };
        Returns: {
          ends_at: string;
          listing_id: string;
          starts_at: string;
        }[];
      };
      session_spots_left: { Args: { p_session_id: string }; Returns: number };
      session_spots_taken: { Args: { p_session_id: string }; Returns: number };
      session_time_label: {
        Args: { p_at: string; p_zone: string };
        Returns: string;
      };
      support_admin_report: {
        Args: { p_admin_id: string; p_report_id: string };
        Returns: {
          booking_id: string | null;
          category: string;
          created_at: string;
          description: string;
          follows_report_id: string | null;
          id: string;
          last_message_at: string;
          last_message_from: string;
          listing_id: string | null;
          provider_id: string;
          reporter_id: string | null;
          resolved_at: string | null;
          status: string;
          status_changed_at: string;
          status_changed_by: string;
          status_changed_by_id: string | null;
          updated_at: string;
          urgent: boolean | null;
        };
        SetofOptions: {
          from: "*";
          to: "support_reports";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      support_column_name: { Args: { p_status: string }; Returns: string };
      support_limit_message: { Args: { p_what: string }; Returns: string };
      unpublish_guide: {
        Args: { p_admin_id: string; p_guide_id: string };
        Returns: undefined;
      };
      wall_clock_instant: {
        Args: { p_local: string; p_zone: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
