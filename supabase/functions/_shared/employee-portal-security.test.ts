import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  getTrustedEmployeePortalIp,
  isMeasurementToken,
} from "./employee-portal-security.ts";

Deno.test("accepts only well-formed UUID measurement tokens", () => {
  assertEquals(
    isMeasurementToken("123e4567-e89b-42d3-a456-426614174000"),
    true,
  );
  assertEquals(isMeasurementToken("not-a-token"), false);
  assertEquals(
    isMeasurementToken("00000000-0000-0000-0000-000000000000"),
    false,
  );
  assertEquals(isMeasurementToken(null), false);
});

Deno.test("uses the gateway-provided client IP", () => {
  const request = new Request(
    "https://project.supabase.co/functions/v1/employee-portal",
    {
      headers: {
        "cf-connecting-ip": "203.0.113.14",
        "x-forwarded-for": "198.51.100.8",
      },
    },
  );

  assertEquals(
    getTrustedEmployeePortalIp(request, "https://epis-epcs.vercel.app"),
    "203.0.113.14",
  );
});

Deno.test("does not trust a caller-supplied forwarded IP", () => {
  const request = new Request(
    "https://project.supabase.co/functions/v1/employee-portal",
    {
      headers: { "x-forwarded-for": "198.51.100.8" },
    },
  );

  assertThrows(
    () => getTrustedEmployeePortalIp(request, "https://epis-epcs.vercel.app"),
    Error,
    "EMPLOYEE_PORTAL_IP_UNAVAILABLE",
  );
});

Deno.test("allows a fixed local IP only for the local portal origin", () => {
  const request = new Request(
    "http://localhost:54321/functions/v1/employee-portal",
  );

  assertEquals(
    getTrustedEmployeePortalIp(request, "http://localhost:3000"),
    "127.0.0.1",
  );
  assertThrows(
    () => getTrustedEmployeePortalIp(request, "https://epis-epcs.vercel.app"),
    Error,
    "EMPLOYEE_PORTAL_IP_UNAVAILABLE",
  );
});
