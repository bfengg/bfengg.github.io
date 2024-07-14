import React from "react";
import {
  VerticalTimeline,
  VerticalTimelineElement,
} from "react-vertical-timeline-component";
import "react-vertical-timeline-component/style.min.css";
import SchoolIcon from "@material-ui/icons/School";
import WorkIcon from "@material-ui/icons/Work";
import "../styles/Experiences.css";

function Experience() {
  return (
    <div className="experience">
      <VerticalTimeline lineColor="#36541b">
        <VerticalTimelineElement
          className="vertical-timeline-element--education"
          date="2023 - Present"
          iconStyle={{ background: "#36541b", color: "#fff" }}
          icon={<SchoolIcon />}
        >
          <h3 className="vertical-timeline-element-title">
            Antimetal
          </h3>
          <h4 className="vertical-timeline-element-subtitle">
            New York City, NY
          </h4>
          <p> Senior Backend Engineer</p>
          
        </VerticalTimelineElement>
        <VerticalTimelineElement
          className="vertical-timeline-element--education"
          date="2022 - 2023"
          iconStyle={{ background: "#36541b", color: "#fff" }}
          icon={<SchoolIcon />}
        >
          <h3 className="vertical-timeline-element-title">
            Goldman Sachs
          </h3>
          <h4 className="vertical-timeline-element-subtitle">
            New York City, NY
          </h4>
          <p> Software Engineer</p>
        </VerticalTimelineElement>
        <VerticalTimelineElement
          className="vertical-timeline-element--work"
          date="2021"
          iconStyle={{ background: "#36541b", color: "#fff" }}
          icon={<WorkIcon />}
        >
          <h3 className="vertical-timeline-element-title">
            Goldman Sachs
          </h3>
          <h4 className="vertical-timeline-element-subtitle">
            Dallas, TX
          </h4>
          <p>Software Engineering Intern</p>
        </VerticalTimelineElement>

        <VerticalTimelineElement
          className="vertical-timeline-element--work"
          date="2020 - 2021"
          iconStyle={{ background: "#36541b", color: "#fff" }}
          icon={<WorkIcon />}
        >
          <h3 className="vertical-timeline-element-title">
            National Chiao Tung University
          </h3>
          <h4 className="vertical-timeline-element-subtitle">
            Hsinchu, Taiwan
          </h4>
          <p>
            Research Data Scientist
          </p>
        </VerticalTimelineElement>

        <VerticalTimelineElement
          className="vertical-timeline-element--work"
          date="2020"
          iconStyle={{ background: "#36541b", color: "#fff" }}
          icon={<WorkIcon />}
        >
          <h3 className="vertical-timeline-element-title">
            National Tsing Hua University
          </h3>
          <h4 className="vertical-timeline-element-subtitle">
            Hsinchu, Taiwan
          </h4>
          <p>
            Statistics Research Assistant
          </p>
        </VerticalTimelineElement>
      </VerticalTimeline>
    </div>
  );
}

export default Experience;
