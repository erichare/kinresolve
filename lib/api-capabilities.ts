import { NextResponse } from "next/server";

import {
  HostedCapabilityError,
  requireHostedCapability,
  resolveHostedCapabilities,
  type HostedCapabilityName
} from "./hosted-capabilities";

type Environment = Record<string, string | undefined>;

export function capabilityUnavailableResponse(
  capability: HostedCapabilityName,
  environment: Environment = process.env
): NextResponse | undefined {
  try {
    requireHostedCapability(capability, environment);
    return undefined;
  } catch (error) {
    if (error instanceof HostedCapabilityError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("Hosted capability configuration is invalid", { capability, error });
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}

export function hostedDeploymentUnavailableResponse(
  environment: Environment = process.env
): NextResponse | undefined {
  try {
    if (resolveHostedCapabilities(environment).deploymentMode === "hosted") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return undefined;
  } catch (error) {
    console.error("Hosted capability configuration is invalid", { error });
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
