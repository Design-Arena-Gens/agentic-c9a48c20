"use client";

import dynamic from "next/dynamic";

const IndiaFromSpace = dynamic(() => import("../components/IndiaFromSpace"), {
  ssr: false,
});

export default function Page() {
  return <IndiaFromSpace />;
}
