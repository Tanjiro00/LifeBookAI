export type ChapterDto = {
  title: string;
  subtitle: string | null;
  quote: string | null;
  content: string;
  createdAt: string;
  isSaved: boolean;
};

export type BookDto = {
  title: string;
  subtitle: string | null;
  chapters: {
    id: string;
    title: string;
    quote: string | null;
    createdAt: string;
  }[];
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getChapter(shareToken: string): Promise<ChapterDto> {
  return fetchJson<ChapterDto>(`/api/chapters/${encodeURIComponent(shareToken)}`);
}

export function getBook(bookId: string): Promise<BookDto> {
  return fetchJson<BookDto>(`/api/books/${encodeURIComponent(bookId)}`);
}

