export type BookEntryDto = {
  id: string;
  sceneTitle: string;
  sceneContent: string;
  quote: string | null;
  accentColor?: string | null;
  createdAt: string;
};

export type BookDto = {
  title: string;
  subtitle: string | null;
  coverUrl?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  entries: BookEntryDto[];
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8090").replace(/\/$/, "");

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function getBook(shareToken: string): Promise<BookDto> {
  return fetchJson<BookDto>(`/api/books/${encodeURIComponent(shareToken)}`);
}
