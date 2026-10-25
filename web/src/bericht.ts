import "./styles.css";
import { marked } from "marked";
import report from "../../FORSCHUNGSBERICHT_MAUS.md?raw";

const article = document.getElementById("bericht")!;
article.innerHTML = await marked.parse(report);
