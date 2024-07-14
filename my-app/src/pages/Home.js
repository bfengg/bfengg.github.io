import { CiLinkedin } from "react-icons/ci";
import { LuGithub } from "react-icons/lu";
import { AiOutlineMediumWorkmark } from "react-icons/ai";
import "../styles/Home.css";


function Home() {
        return (
            <div className="home">
                <div className="about">               
                    <h2> Hey, this is Brian.</h2>
                    <div className="subtitle">
                        <p>I <i>build</i>, <i>read</i>, and <i>golf</i>.</p>
                        <a href="https://github.com/bfengg"><LuGithub /></a>
                        <a href="https://medium.com/@brianfeng717_79832"><AiOutlineMediumWorkmark /></a>
                        <a href="https://www.linkedin.com/in/briantfeng/"><CiLinkedin /></a>
                        
                    </div>
                </div>
            </div>
        );
      }
export default Home;
