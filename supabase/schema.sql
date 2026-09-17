-- Memon HMS – inferred Supabase schema (empty project bootstrap)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.app_role AS ENUM (
  'GeneralUser', 'Patient', 'Doctor', 'Admin', 'Ambulance', 'ICU',
  'Pharmacy', 'BloodBank', 'Blood Bank', 'Volunteer'
);
CREATE TYPE public.doctor_status AS ENUM ('Available', 'On Leave', 'Busy', 'Inactive');
CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
CREATE TYPE public.prescription_status AS ENUM ('pending', 'active', 'dispensed', 'rejected');
CREATE TYPE public.ambulance_status AS ENUM ('Available', 'On Duty', 'Maintenance', 'Offline');
CREATE TYPE public.ambulance_type AS ENUM ('Basic', 'Advanced', 'ICU', 'Emergency');
CREATE TYPE public.ambulance_request_status AS ENUM (
  'pending', 'assigned', 'en_route', 'arrived', 'patient_picked',
  'arrived_at_hospital', 'completed', 'cancelled'
);
CREATE TYPE public.priority_hlm AS ENUM ('High', 'Medium', 'Low');
CREATE TYPE public.icu_bed_status AS ENUM ('available', 'occupied', 'reserved', 'maintenance');
CREATE TYPE public.icu_request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.icu_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.condition_status AS ENUM ('stable', 'critical', 'improving', 'emergency');
CREATE TYPE public.medicine_unit AS ENUM ('Tablets', 'Capsules', 'Vials', 'Bottles', 'Tubes', 'Units');
CREATE TYPE public.purchase_order_status AS ENUM ('pending', 'received', 'cancelled');
CREATE TYPE public.blood_group AS ENUM ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-');
CREATE TYPE public.blood_component AS ENUM ('whole_blood', 'plasma', 'platelets', 'rbc');
CREATE TYPE public.blood_unit_status AS ENUM (
  'collected', 'testing', 'available', 'allocated', 'transfused', 'disposed'
);
CREATE TYPE public.blood_test_status AS ENUM ('pending', 'passed', 'failed');
CREATE TYPE public.blood_request_status AS ENUM ('pending', 'approved', 'rejected', 'fulfilled');
CREATE TYPE public.blood_urgency AS ENUM ('routine', 'urgent', 'emergency');
CREATE TYPE public.donation_request_status AS ENUM ('open', 'closed');
CREATE TYPE public.volunteer_donation_status AS ENUM ('pending', 'completed');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  phone text,
  role public.app_role NOT NULL DEFAULT 'Patient',
  is_active boolean NOT NULL DEFAULT true,
  specialty text,
  department text,
  license_number text,
  years_experience integer,
  consultation_fee text,
  schedule text,
  doctor_status public.doctor_status,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_role_idx ON public.profiles (role);
CREATE INDEX profiles_is_active_idx ON public.profiles (is_active);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_role text;
  resolved_role public.app_role;
BEGIN
  meta_role := COALESCE(NEW.raw_user_meta_data->>'role', '');
  IF meta_role = '' THEN
    resolved_role := 'Patient';
  ELSIF meta_role IN (
    'GeneralUser','Patient','Doctor','Admin','Ambulance','ICU',
    'Pharmacy','BloodBank','Blood Bank','Volunteer'
  ) THEN
    resolved_role := meta_role::public.app_role;
  ELSE
    resolved_role := 'Patient';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    resolved_role,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.volunteer_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  blood_group public.blood_group NOT NULL DEFAULT 'O+',
  is_available boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_patient_idx ON public.appointments (patient_id);
CREATE INDEX appointments_doctor_idx ON public.appointments (doctor_id);

CREATE TABLE public.medical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  diagnosis text,
  notes text,
  observations text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  medical_record_id uuid REFERENCES public.medical_records(id) ON DELETE SET NULL,
  medication text,
  dosage text,
  instructions text,
  frequency text,
  duration text,
  quantity integer DEFAULT 1,
  special_instructions text,
  status public.prescription_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  manufacturer text,
  category text NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  unit public.medicine_unit NOT NULL DEFAULT 'Tablets',
  storage_conditions text DEFAULT 'Room Temperature',
  expiry_date date,
  price_per_unit numeric(12,2) NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medicine_id uuid REFERENCES public.medicines(id) ON DELETE SET NULL,
  medication_text text,
  dosage text,
  frequency text,
  quantity integer DEFAULT 1,
  instructions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.dispense_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  dispensed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dispensed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  supplier_name text NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery date,
  status public.purchase_order_status NOT NULL DEFAULT 'pending',
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  medicine_id uuid REFERENCES public.medicines(id) ON DELETE SET NULL,
  medicine_name text NOT NULL DEFAULT 'Item',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total_price numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ambulances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number text NOT NULL UNIQUE,
  ambulance_type public.ambulance_type NOT NULL,
  equipment_details text,
  status public.ambulance_status NOT NULL DEFAULT 'Available',
  current_location text,
  current_lat double precision,
  current_lng double precision,
  location_updated_at timestamptz,
  driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ambulance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  priority public.priority_hlm NOT NULL DEFAULT 'Medium',
  status public.ambulance_request_status NOT NULL DEFAULT 'pending',
  ambulance_id uuid REFERENCES public.ambulances(id) ON DELETE SET NULL,
  assigned_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  trip_notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ambulance_trip_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.ambulance_requests(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed_kmh double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.icu_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_number text NOT NULL UNIQUE,
  bed_type text NOT NULL,
  ward text,
  floor text,
  equipment_list text[] NOT NULL DEFAULT '{}',
  status public.icu_bed_status NOT NULL DEFAULT 'available',
  current_patient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admission_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.icu_admission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_status public.icu_request_status NOT NULL DEFAULT 'pending',
  priority_level public.icu_priority NOT NULL DEFAULT 'medium',
  assigned_bed_id uuid REFERENCES public.icu_beds(id) ON DELETE SET NULL,
  request_notes text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.icu_admission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bed_id uuid NOT NULL REFERENCES public.icu_beds(id) ON DELETE RESTRICT,
  request_id uuid REFERENCES public.icu_admission_requests(id) ON DELETE SET NULL,
  admission_time timestamptz NOT NULL DEFAULT now(),
  discharge_time timestamptz,
  discharge_reason text,
  final_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.icu_beds
  ADD CONSTRAINT icu_beds_admission_id_fkey
  FOREIGN KEY (admission_id) REFERENCES public.icu_admission_records(id) ON DELETE SET NULL;

CREATE TABLE public.icu_patient_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bed_id uuid REFERENCES public.icu_beds(id) ON DELETE SET NULL,
  admission_record_id uuid REFERENCES public.icu_admission_records(id) ON DELETE SET NULL,
  vital_signs jsonb NOT NULL DEFAULT '{}'::jsonb,
  observation_notes text,
  condition_status public.condition_status,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_code text UNIQUE,
  full_name text NOT NULL,
  blood_group public.blood_group NOT NULL,
  contact_phone text,
  contact_email text,
  medical_screening_notes text,
  last_donation_date date,
  total_donations integer NOT NULL DEFAULT 0,
  eligible_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid REFERENCES public.donors(id) ON DELETE SET NULL,
  blood_group public.blood_group NOT NULL,
  component_type public.blood_component NOT NULL DEFAULT 'whole_blood',
  collection_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  status public.blood_unit_status NOT NULL DEFAULT 'collected',
  storage_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_testing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.blood_units(id) ON DELETE CASCADE,
  test_results jsonb,
  test_status public.blood_test_status NOT NULL DEFAULT 'pending',
  approved_flag boolean NOT NULL DEFAULT false,
  tested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE DEFAULT ('BR-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blood_group_required public.blood_group NOT NULL,
  units_required integer NOT NULL DEFAULT 1 CHECK (units_required >= 1),
  urgency_level public.blood_urgency NOT NULL DEFAULT 'routine',
  medical_reason text,
  rejection_reason text,
  request_status public.blood_request_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.blood_requests(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.blood_units(id) ON DELETE RESTRICT,
  allocated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  allocation_time timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, unit_id)
);

CREATE TABLE public.transfusion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.blood_units(id) ON DELETE RESTRICT,
  request_id uuid REFERENCES public.blood_requests(id) ON DELETE SET NULL,
  transfusion_time timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.disposal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.blood_units(id) ON DELETE CASCADE,
  disposal_reason text NOT NULL,
  disposal_date date NOT NULL DEFAULT CURRENT_DATE,
  disposed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blood_donation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blood_group public.blood_group NOT NULL,
  quantity_required integer NOT NULL DEFAULT 1 CHECK (quantity_required >= 1),
  location text,
  urgency public.priority_hlm NOT NULL DEFAULT 'Medium',
  status public.donation_request_status NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.volunteer_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  donation_request_id uuid NOT NULL REFERENCES public.blood_donation_requests(id) ON DELETE CASCADE,
  status public.volunteer_donation_status NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (volunteer_id, donation_request_id)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','volunteer_profiles','appointments','medical_records','prescriptions',
    'prescription_items','medicines','dispense_records','purchase_orders','purchase_order_items',
    'ambulances','ambulance_requests','ambulance_trip_locations',
    'icu_beds','icu_admission_requests','icu_admission_records','icu_patient_monitoring',
    'donors','blood_units','blood_testing','blood_requests','blood_allocations',
    'transfusion_logs','disposal_logs','blood_donation_requests','volunteer_donations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated_all', t
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
