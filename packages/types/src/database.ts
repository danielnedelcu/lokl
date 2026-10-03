export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          id: string
          message: string | null
          reason: string | null
          target: string
          target_id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          reason?: string | null
          target: string
          target_id: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          reason?: string | null
          target?: string
          target_id?: string
        }
        Relationships: []
      }
      booking_addresses: {
        Row: {
          booking_id: string
          city: string
          instructions: string | null
          line1: string
          line2: string | null
          postal_code: string
          state: string
        }
        Insert: {
          booking_id: string
          city: string
          instructions?: string | null
          line1: string
          line2?: string | null
          postal_code: string
          state: string
        }
        Update: {
          booking_id?: string
          city?: string
          instructions?: string | null
          line1?: string
          line2?: string | null
          postal_code?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_addresses_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_contacts: {
        Row: {
          booking_id: string
          email: string
          phone: string | null
        }
        Insert: {
          booking_id: string
          email: string
          phone?: string | null
        }
        Update: {
          booking_id?: string
          email?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_contacts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_emails: {
        Row: {
          attempts: number
          booking_id: string
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string
          recipient: string
          resend_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          to_address: string | null
        }
        Insert: {
          attempts?: number
          booking_id: string
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          recipient?: string
          resend_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          to_address?: string | null
        }
        Update: {
          attempts?: number
          booking_id?: string
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string
          recipient?: string
          resend_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_emails_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_events: {
        Row: {
          actor: string
          booking_id: string
          created_at: string
          from_status: string | null
          id: string
          to_status: string
        }
        Insert: {
          actor: string
          booking_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          to_status: string
        }
        Update: {
          actor?: string
          booking_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission_cents: number
          commission_rate_bps: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_city: string | null
          customer_id: string
          customer_name: string
          customer_notes: string | null
          customer_postal_code: string | null
          dispute_amount_cents: number | null
          dispute_closed_at: string | null
          dispute_evidence_due_by: string | null
          dispute_outcome: string | null
          dispute_reason: string | null
          disputed_at: string | null
          ends_at: string | null
          id: string
          kind: string
          listing_id: string
          party_size: number
          payout_due_at: string | null
          payout_failed_at: string | null
          payout_failure: string | null
          payout_held_at: string | null
          payout_hold: string | null
          preferred_times: string[] | null
          problem_note: string | null
          problem_reported_at: string | null
          problem_resolution: string | null
          problem_resolved_at: string | null
          provider_amount_cents: number
          provider_id: string
          refunded_at: string | null
          refunded_cents: number
          reserved_until: string | null
          respond_by: string | null
          reversal_failed_at: string | null
          reversal_failure: string | null
          session_id: string | null
          starts_at: string | null
          status: string
          status_changed_by: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_dispute_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission_cents: number
          commission_rate_bps: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_city?: string | null
          customer_id: string
          customer_name: string
          customer_notes?: string | null
          customer_postal_code?: string | null
          dispute_amount_cents?: number | null
          dispute_closed_at?: string | null
          dispute_evidence_due_by?: string | null
          dispute_outcome?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          ends_at?: string | null
          id?: string
          kind: string
          listing_id: string
          party_size?: number
          payout_due_at?: string | null
          payout_failed_at?: string | null
          payout_failure?: string | null
          payout_held_at?: string | null
          payout_hold?: string | null
          preferred_times?: string[] | null
          problem_note?: string | null
          problem_reported_at?: string | null
          problem_resolution?: string | null
          problem_resolved_at?: string | null
          provider_amount_cents: number
          provider_id: string
          refunded_at?: string | null
          refunded_cents?: number
          reserved_until?: string | null
          respond_by?: string | null
          reversal_failed_at?: string | null
          reversal_failure?: string | null
          session_id?: string | null
          starts_at?: string | null
          status?: string
          status_changed_by?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
          total_cents: number
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission_cents?: number
          commission_rate_bps?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_city?: string | null
          customer_id?: string
          customer_name?: string
          customer_notes?: string | null
          customer_postal_code?: string | null
          dispute_amount_cents?: number | null
          dispute_closed_at?: string | null
          dispute_evidence_due_by?: string | null
          dispute_outcome?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          listing_id?: string
          party_size?: number
          payout_due_at?: string | null
          payout_failed_at?: string | null
          payout_failure?: string | null
          payout_held_at?: string | null
          payout_hold?: string | null
          preferred_times?: string[] | null
          problem_note?: string | null
          problem_reported_at?: string | null
          problem_resolution?: string | null
          problem_resolved_at?: string | null
          provider_amount_cents?: number
          provider_id?: string
          refunded_at?: string | null
          refunded_cents?: number
          reserved_until?: string | null
          respond_by?: string | null
          reversal_failed_at?: string | null
          reversal_failure?: string | null
          session_id?: string | null
          starts_at?: string | null
          status?: string
          status_changed_by?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
          total_cents?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "experience_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cities: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          state: string
          timezone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          state: string
          timezone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          state?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      commission_rate_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          kind: string
          new_rate_bps: number
          old_rate_bps: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          kind: string
          new_rate_bps: number
          old_rate_bps: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          kind?: string
          new_rate_bps?: number
          old_rate_bps?: number
        }
        Relationships: []
      }
      commission_rates: {
        Row: {
          kind: string
          rate_bps: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          kind: string
          rate_bps: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          kind?: string
          rate_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      experience_sessions: {
        Row: {
          capacity: number
          created_at: string
          id: string
          listing_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          id?: string
          listing_id: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          listing_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experience_sessions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          changed: number
          checked: number
          error: string | null
          failed: number
          failures: string[]
          finished_at: string
          id: string
          job: string
          started_at: string
        }
        Insert: {
          changed?: number
          checked?: number
          error?: string | null
          failed?: number
          failures?: string[]
          finished_at?: string
          id?: string
          job: string
          started_at: string
        }
        Update: {
          changed?: number
          checked?: number
          error?: string | null
          failed?: number
          failures?: string[]
          finished_at?: string
          id?: string
          job?: string
          started_at?: string
        }
        Relationships: []
      }
      listing_addresses: {
        Row: {
          city: string
          created_at: string
          instructions: string | null
          line1: string
          line2: string | null
          listing_id: string
          postal_code: string
          state: string
          updated_at: string
        }
        Insert: {
          city: string
          created_at?: string
          instructions?: string | null
          line1: string
          line2?: string | null
          listing_id: string
          postal_code: string
          state: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          instructions?: string | null
          line1?: string
          line2?: string | null
          listing_id?: string
          postal_code?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_addresses_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_photos: {
        Row: {
          alt_text: string
          card_path: string | null
          created_at: string
          id: string
          listing_id: string
          position: number
          storage_path: string
          updated_at: string
        }
        Insert: {
          alt_text: string
          card_path?: string | null
          created_at?: string
          id?: string
          listing_id: string
          position: number
          storage_path: string
          updated_at?: string
        }
        Update: {
          alt_text?: string
          card_path?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          position?: number
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_service_areas: {
        Row: {
          created_at: string
          listing_id: string
          service_area_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          service_area_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          service_area_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_service_areas_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_service_areas_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          area_id: string | null
          category_id: string
          city_id: string
          created_at: string
          currency: string
          description: string
          duration_minutes: number | null
          id: string
          kind: string
          location_mode: string | null
          price_cents: number
          provider_id: string
          published_at: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          slug: string
          status: string
          submitted_at: string | null
          title: string
          unpublished_reason: string | null
          updated_at: string
        }
        Insert: {
          area_id?: string | null
          category_id: string
          city_id: string
          created_at?: string
          currency?: string
          description: string
          duration_minutes?: number | null
          id?: string
          kind: string
          location_mode?: string | null
          price_cents: number
          provider_id: string
          published_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          slug: string
          status?: string
          submitted_at?: string | null
          title: string
          unpublished_reason?: string | null
          updated_at?: string
        }
        Update: {
          area_id?: string | null
          category_id?: string
          city_id?: string
          created_at?: string
          currency?: string
          description?: string
          duration_minutes?: number | null
          id?: string
          kind?: string
          location_mode?: string | null
          price_cents?: number
          provider_id?: string
          published_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          slug?: string
          status?: string
          submitted_at?: string | null
          title?: string
          unpublished_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_category_id_kind_fkey"
            columns: ["category_id", "kind"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "listings_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          kind: string
          listing_id: string
          provider_id: string
          read_at: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          kind: string
          listing_id: string
          provider_id: string
          read_at?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          listing_id?: string
          provider_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_emails: {
        Row: {
          admin_action_id: string
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          message: string | null
          next_attempt_at: string
          provider_id: string
          resend_id: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          to_address: string | null
        }
        Insert: {
          admin_action_id: string
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          message?: string | null
          next_attempt_at?: string
          provider_id: string
          resend_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          to_address?: string | null
        }
        Update: {
          admin_action_id?: string
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          message?: string | null
          next_attempt_at?: string
          provider_id?: string
          resend_id?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_emails_admin_action_id_fkey"
            columns: ["admin_action_id"]
            isOneToOne: true
            referencedRelation: "admin_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_emails_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          city_id: string
          created_at: string
          display_name: string
          id: string
          owner_id: string
          status: string
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_details_submitted: boolean
          stripe_payouts_enabled: boolean
          updated_at: string
        }
        Insert: {
          city_id: string
          created_at?: string
          display_name: string
          id?: string
          owner_id: string
          status?: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          city_id?: string
          created_at?: string
          display_name?: string
          id?: string
          owner_id?: string
          status?: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          active: boolean
          city_id: string
          created_at: string
          id: string
          kind: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          city_id: string
          created_at?: string
          id?: string
          kind: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          city_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_set_provider_status: {
        Args: {
          p_admin_id: string
          p_message: string
          p_provider_id: string
          p_reason: string
          p_status: string
        }
        Returns: boolean
      }
      booking_emails_queue: {
        Args: { p_booking_id: string; p_kinds: string[] }
        Returns: undefined
      }
      booking_money: {
        Args: { p_kind: string; p_party: number; p_unit_price: number }
        Returns: Record<string, unknown>
      }
      create_service_request: {
        Args: {
          p_address: Json
          p_customer_email: string
          p_customer_id: string
          p_customer_name: string
          p_customer_notes: string
          p_customer_phone: string
          p_listing_id: string
          p_preferred_times: string[]
          p_reserved_until: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission_cents: number
          commission_rate_bps: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_city: string | null
          customer_id: string
          customer_name: string
          customer_notes: string | null
          customer_postal_code: string | null
          dispute_amount_cents: number | null
          dispute_closed_at: string | null
          dispute_evidence_due_by: string | null
          dispute_outcome: string | null
          dispute_reason: string | null
          disputed_at: string | null
          ends_at: string | null
          id: string
          kind: string
          listing_id: string
          party_size: number
          payout_due_at: string | null
          payout_failed_at: string | null
          payout_failure: string | null
          payout_held_at: string | null
          payout_hold: string | null
          preferred_times: string[] | null
          problem_note: string | null
          problem_reported_at: string | null
          problem_resolution: string | null
          problem_resolved_at: string | null
          provider_amount_cents: number
          provider_id: string
          refunded_at: string | null
          refunded_cents: number
          reserved_until: string | null
          respond_by: string | null
          reversal_failed_at: string | null
          reversal_failure: string | null
          session_id: string | null
          starts_at: string | null
          status: string
          status_changed_by: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_dispute_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_provider_id: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      listing_parents_active: {
        Args: {
          p_category_id: string
          p_city_id: string
          p_provider_id: string
        }
        Returns: boolean
      }
      reorder_listing_photos: {
        Args: { p_listing_id: string; p_photo_ids: string[] }
        Returns: undefined
      }
      reserve_experience_booking: {
        Args: {
          p_customer_email: string
          p_customer_id: string
          p_customer_name: string
          p_customer_notes: string
          p_customer_phone: string
          p_party_size: number
          p_reserved_until: string
          p_session_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission_cents: number
          commission_rate_bps: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_city: string | null
          customer_id: string
          customer_name: string
          customer_notes: string | null
          customer_postal_code: string | null
          dispute_amount_cents: number | null
          dispute_closed_at: string | null
          dispute_evidence_due_by: string | null
          dispute_outcome: string | null
          dispute_reason: string | null
          disputed_at: string | null
          ends_at: string | null
          id: string
          kind: string
          listing_id: string
          party_size: number
          payout_due_at: string | null
          payout_failed_at: string | null
          payout_failure: string | null
          payout_held_at: string | null
          payout_hold: string | null
          preferred_times: string[] | null
          problem_note: string | null
          problem_reported_at: string | null
          problem_resolution: string | null
          problem_resolved_at: string | null
          provider_amount_cents: number
          provider_id: string
          refunded_at: string | null
          refunded_cents: number
          reserved_until: string | null
          respond_by: string | null
          reversal_failed_at: string | null
          reversal_failure: string | null
          session_id: string | null
          starts_at: string | null
          status: string
          status_changed_by: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_dispute_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      session_spots_left: { Args: { p_session_id: string }; Returns: number }
      session_spots_taken: { Args: { p_session_id: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
