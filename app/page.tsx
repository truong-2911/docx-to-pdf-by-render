export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>DOCX → PDF</h1>
      <p>Endpoints:</p>
      <ul>
        <li>POST <code>/api/convert</code> (form-data: <b>file</b>)</li>
        <li>POST <code>/api/map-data-and-convert</code> (form-data: <b>file</b>, <b>data</b> JSON, optional <b>name</b>)</li>
      </ul>
    </main>
  );
}
