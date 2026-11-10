import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// A file's size as people read it.
export const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 ** 2
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 ** 2).toFixed(1)} MB`;
