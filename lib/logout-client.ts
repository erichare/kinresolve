type LogoutFetch = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, "status" | "type" | "url">>;

export async function requestSameOriginLogout(
  fetchLogout: LogoutFetch = fetch
): Promise<void> {
  const response = await fetchLogout("/api/auth/logout", {
    body: "",
    credentials: "same-origin",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    method: "POST",
    redirect: "error"
  });
  const responseUrl = new URL(response.url);
  if (
    response.type !== "basic"
    || response.status !== 204
    || responseUrl.pathname !== "/api/auth/logout"
  ) {
    throw new Error("Logout request was not accepted");
  }
}
