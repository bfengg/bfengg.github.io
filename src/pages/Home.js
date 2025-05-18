import { CiLinkedin } from "react-icons/ci";
import { LuGithub } from "react-icons/lu";
import { AiOutlineMediumWorkmark } from "react-icons/ai";
import { useState } from "react";
import "../styles/Home.css";

function Home() {
  const [isGolfMode, setIsGolfMode] = useState(false);

  return (
    <div className={`home ${isGolfMode ? "golf-mode" : ""}`}>
      <div className="about">
        <h2> Hey, this is Brian.</h2>
        <div className="subtitle">
          <p>
            I <i>build</i>, <i>read</i>, and{" "}
            <i>
              <span className="golf-text" onClick={() => setIsGolfMode(true)}>
                golf
              </span>
            </i>
            .
          </p>
          <a href="https://github.com/bfengg">
            <LuGithub />
          </a>
          <a href="https://medium.com/@brianfeng717_79832">
            <AiOutlineMediumWorkmark />
          </a>
          <a href="https://www.linkedin.com/in/briantfeng/">
            <CiLinkedin />
          </a>
        </div>
      </div>
    </div>
  );
}
export default Home;
